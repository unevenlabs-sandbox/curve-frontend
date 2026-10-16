import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  maxUint256,
  zeroHash,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayDepository } from '@relay-protocol/settlement-abis'
import type { Config } from '@wagmi/core'
import { getDepositRoute } from './deployments'
import { checkDepositTransaction, submitDepositAction } from './deposit-actions'
import {
  canSubmitDeposit,
  createDepositOperation,
  DEPOSIT_STORAGE_KEY,
  parseDepositAmount,
  readDepositOperation,
  type DepositOperation,
} from './deposit-operation'
import { validateFundingSetup } from './funding-setup'

type ContractRequest = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }
const rpc = vi.hoisted(() => ({
  read: vi.fn<(_config: Config, request: ContractRequest) => Promise<bigint | number>>(),
  simulate: vi.fn<() => Promise<object>>(),
  write: vi.fn<(_config: Config, request: ContractRequest) => Promise<Hash>>(),
  connection:
    vi.fn<
      () => {
        isConnected: boolean
        address?: Address
        connector?: { getAccounts: () => Promise<Address[]>; getChainId: () => Promise<number> }
      }
    >(),
  code: vi.fn<() => Promise<Hex>>(),
  receipt:
    vi.fn<
      (params: { onReplaced: (params: { transaction: { hash: Hash } }) => void }) => Promise<ReturnType<typeof receipt>>
    >(),
  transaction: vi.fn<() => Promise<{ from: Address; to: Address; input: Hex; value: bigint }>>(),
}))
vi.mock('@wagmi/core', () => ({
  readContract: rpc.read,
  simulateContract: rpc.simulate,
  writeContract: rpc.write,
  getConnection: rpc.connection,
  getPublicClient: () => ({
    getCode: rpc.code,
    waitForTransactionReceipt: rpc.receipt,
    getTransaction: rpc.transaction,
  }),
}))

const setup = validateFundingSetup({
  deploymentId: 'dev',
  sourceChainId: 8453,
  walletChainId: 8453,
  sourceOwner: '0x1111111111111111111111111111111111111111',
  recipient: '0x2222222222222222222222222222222222222222',
}).setup!
const route = getDepositRoute('dev', 8453)!
const HASH: Hash = `0x${'a'.repeat(64)}`
const REPLACEMENT: Hash = `0x${'b'.repeat(64)}`
const abi = RelayDepository as Abi
let records: Map<string, string>
let current: DepositOperation | undefined
let accounts: `0x${string}`[]
let chainId: number
let locked: boolean
const storage = {
  getItem: (key: string) => records.get(key) ?? null,
  setItem: (key: string, value: string) => {
    records.set(key, value)
  },
}
const context = {
  config: {} as Config,
  storage,
  onChange: (op: DepositOperation) => {
    current = op
  },
}
const saved = () => readDepositOperation(storage)!
const submit = (step: 'approval' | 'deposit' = 'deposit') => submitDepositAction(context, setup, '1.000001', step)

const depositLog = (overrides = {}) => ({
  address: route.depository,
  topics: encodeEventTopics({ abi, eventName: 'RelayErc20Deposit' }),
  data: encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
    [setup.sourceOwner, route.token, 1_000_001n, zeroHash],
  ),
  blockNumber: 100n,
  blockHash: zeroHash,
  transactionHash: HASH,
  logIndex: 3,
  transactionIndex: 0,
  removed: false,
  ...overrides,
})
const receipt = (overrides = {}) => ({
  status: 'success',
  transactionHash: HASH,
  blockNumber: 100n,
  logs: [depositLog()],
  ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  records = new Map()
  current = undefined
  accounts = [setup.sourceOwner]
  chainId = 8453
  locked = false
  vi.stubGlobal('navigator', {
    locks: {
      request: async (_name: string, _options: unknown, action: (lock: object | null) => Promise<unknown>) => {
        if (locked) return action(null)
        locked = true
        try {
          return await action({})
        } finally {
          locked = false
        }
      },
    },
  })
  rpc.connection.mockImplementation(() => ({
    isConnected: true,
    address: setup.sourceOwner,
    connector: { getAccounts: () => Promise.resolve(accounts), getChainId: () => Promise.resolve(chainId) },
  }))
  rpc.read.mockImplementation((_config, request) =>
    Promise.resolve(request.functionName === 'decimals' ? 6 : 10_000_000n),
  )
  rpc.code.mockResolvedValue('0x6000')
  rpc.simulate.mockResolvedValue({})
  rpc.write.mockResolvedValue(HASH)
  rpc.receipt.mockImplementation(() => Promise.resolve(receipt()))
  rpc.transaction.mockImplementation(() => {
    const request = rpc.write.mock.lastCall?.[1] ?? {
      address: route.depository,
      abi,
      functionName: 'depositErc20',
      args: [setup.sourceOwner, route.token, 1_000_001n, zeroHash],
    }
    return Promise.resolve({
      from: setup.sourceOwner,
      to: request.address,
      input: encodeFunctionData(request),
      value: 0n,
    })
  })
})

describe('USDC amounts and routes', () => {
  it.each(['', '0', '0.000000', '-1', '1e6', '1,000', '.1', '1.', '1.0000001', ' 1', 'Infinity'])(
    'rejects %s without rounding',
    value => {
      expect(() => parseDepositAmount(value)).toThrow()
    },
  )
  it('preserves exact raw units and checks the uint256 boundary', () => {
    expect(parseDepositAmount('10')).toBe(10_000_000n)
    expect(parseDepositAmount('10.50')).toBe(10_500_000n)
    expect(parseDepositAmount('0.000001')).toBe(1n)
    expect(parseDepositAmount('9007199254740993.123456')).toBe(9007199254740993123456n)
    expect(parseDepositAmount(formatUnits(maxUint256, 6))).toBe(maxUint256)
    expect(() => parseDepositAmount(formatUnits(maxUint256 + 1n, 6))).toThrow()
  })
  it.each([8453, 42161, 137, 1])('resolves deployment-specific Depositories for EVM chain %s', sourceChainId => {
    expect(getDepositRoute('dev', sourceChainId)?.depository).toBe('0x5cb1de3603a71ac2f67b12bfbf095013fe4ac299')
    expect(getDepositRoute('stag', sourceChainId)?.depository).toBe('0x9ddc6a541e8f8b50b0996786a3ec275ab4d3a76c')
    expect(getDepositRoute('prod', sourceChainId)?.depository).toBe('0x4cd00e387622c35bddb9b4c962c136462338bc31')
  })
  it('does not reuse ordinary USDC deposits for Arc Gateway or unknown deployments', () => {
    expect(getDepositRoute('stag', 5042)).toBeUndefined()
    expect(getDepositRoute('unknown', 8453)).toBeUndefined()
    expect(getDepositRoute('toString', 8453)).toBeUndefined()
  })
})

describe('source deposit submission', () => {
  it('deposits the exact amount for the source owner with zero ID and saves the matching event', async () => {
    await submit()
    expect(rpc.write).toHaveBeenCalledOnce()
    expect(rpc.write.mock.lastCall?.[1]).toMatchObject({
      chainId: 8453,
      account: setup.sourceOwner,
      address: route.depository,
      functionName: 'depositErc20',
      args: [setup.sourceOwner, route.token, 1_000_001n, zeroHash],
    })
    expect(saved()).toMatchObject({
      setup,
      currency: 'usdc',
      amount: '1000001',
      status: 'confirmed',
      depositEvent: { transactionHash: HASH, blockNumber: '100', logIndex: 3 },
    })
    await expect(submit()).rejects.toThrow('previous transfer')
    expect(rpc.write).toHaveBeenCalledOnce()
  })
  it('approves only the amount and waits for another user action before depositing', async () => {
    rpc.read.mockImplementation((_config, request) =>
      Promise.resolve(
        request.functionName === 'decimals' ? 6 : request.functionName === 'allowance' ? 0n : 10_000_000n,
      ),
    )
    await submit('approval')
    expect(rpc.write.mock.lastCall?.[1]).toMatchObject({
      account: setup.sourceOwner,
      address: route.token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [route.depository, 1_000_001n],
    })
    expect(saved().status).toBe('ready')
    expect(saved().transactions).toEqual([{ step: 'approval', hash: HASH, status: 'confirmed' }])
    expect(rpc.write).toHaveBeenCalledOnce()
  })
  it.each([
    ['decimals', 18, 'verify USDC'],
    ['balanceOf', 1n, 'enough USDC'],
    ['allowance', 0n, 'Approve'],
  ])('blocks an invalid %s preflight', async (field, result, message) => {
    rpc.read.mockImplementation((_config, request) =>
      Promise.resolve(request.functionName === field ? result : request.functionName === 'decimals' ? 6 : 10_000_000n),
    )
    await expect(submit()).rejects.toThrow(String(message))
    expect(rpc.write).not.toHaveBeenCalled()
    expect(saved().status).toBe('ready')
  })
  it('blocks a missing Depository', async () => {
    rpc.code.mockResolvedValue('0x')
    await expect(submit()).rejects.toThrow('Transfers are unavailable')
    expect(rpc.write).not.toHaveBeenCalled()
  })
  it.each(['account', 'chain'])('checks a changed %s again after simulation', async kind => {
    rpc.simulate.mockImplementation(() => {
      if (kind === 'account') accounts = [setup.recipient]
      else chainId = 1
      return Promise.resolve({})
    })
    await expect(submit()).rejects.toThrow('wallet and network used')
    expect(rpc.write).not.toHaveBeenCalled()
    expect(saved().setup).toEqual(setup)
  })
  it('keeps the operation retryable after an explicit wallet rejection', async () => {
    rpc.write.mockRejectedValue({ cause: { code: 4001 } })
    await expect(submit()).rejects.toBeDefined()
    expect(saved().status).toBe('rejected')
    expect(canSubmitDeposit(saved())).toBe(true)
    expect(saved().transactions).toEqual([])
  })
  it('does not lose the approval reference when the following deposit signature is rejected', async () => {
    rpc.read.mockImplementation((_config, request) =>
      Promise.resolve(
        request.functionName === 'decimals' ? 6 : request.functionName === 'allowance' ? 0n : 10_000_000n,
      ),
    )
    await submit('approval')
    const id = saved().id
    rpc.read.mockImplementation((_config, request) =>
      Promise.resolve(request.functionName === 'decimals' ? 6 : 10_000_000n),
    )
    rpc.write.mockRejectedValueOnce({ code: 4001 })
    await expect(submit()).rejects.toBeDefined()
    expect(saved()).toMatchObject({
      id,
      status: 'rejected',
      transactions: [{ step: 'approval', hash: HASH, status: 'confirmed' }],
    })
  })
  it('blocks another submission after an uncertain wallet response, including after reload', async () => {
    rpc.write.mockRejectedValue(new Error('Disconnected after broadcast'))
    await expect(submit()).rejects.toThrow('Disconnected')
    expect(saved().status).toBe('unknown')
    await expect(submit()).rejects.toThrow('previous transfer')
    expect(rpc.write).toHaveBeenCalledOnce()
  })
  it('treats a missing transaction hash as an uncertain submission', async () => {
    rpc.write.mockResolvedValueOnce('0x')
    await expect(submit()).rejects.toThrow('confirm submission')
    expect(saved().status).toBe('unknown')
    expect(canSubmitDeposit(saved())).toBe(false)
  })
  it('normalizes wallet hashes before checking source receipts', async () => {
    rpc.write.mockResolvedValueOnce(`0x${'A'.repeat(64)}`)
    await submit()
    expect(saved().status).toBe('confirmed')
    expect(saved().transactions[0].hash).toBe(HASH)
  })
  it('checks a saved pending HASH after a receipt timeout without needing a connected wallet', async () => {
    rpc.receipt.mockRejectedValueOnce(new Error('Timed out'))
    await expect(submit()).rejects.toThrow('Timed out')
    expect(saved().status).toBe('pending')
    await expect(submit()).rejects.toThrow('previous transfer')
    rpc.connection.mockReturnValue({ isConnected: false })
    await checkDepositTransaction(context)
    expect(saved().status).toBe('confirmed')
    expect(rpc.write).toHaveBeenCalledOnce()
  })
  it('retains a reverted deposit reference and allows an explicit retry', async () => {
    rpc.receipt.mockResolvedValueOnce(receipt({ status: 'reverted', logs: [] }))
    await submit()
    expect(saved().transactions[0]).toMatchObject({ hash: HASH, status: 'reverted' })
    expect(canSubmitDeposit(saved())).toBe(true)
  })
  it('does not confirm a successful receipt without the matching deposit event', async () => {
    rpc.receipt.mockResolvedValueOnce(receipt({ logs: [depositLog({ address: setup.recipient })] }))
    await submit()
    expect(saved().status).toBe('unknown')
    expect(canSubmitDeposit(saved())).toBe(false)
  })
  it('blocks retry when a successful replacement changed the deposit calldata', async () => {
    rpc.transaction.mockResolvedValueOnce({
      from: setup.sourceOwner,
      to: route.depository,
      value: 0n,
      input: '0x12345678',
    })
    await submit()
    expect(saved().status).toBe('unknown')
    expect(canSubmitDeposit(saved())).toBe(false)
  })
  it('follows a repriced transaction and saves both hashes', async () => {
    rpc.receipt.mockImplementationOnce(({ onReplaced }) => {
      onReplaced({ transaction: { hash: REPLACEMENT } })
      return Promise.resolve(receipt({ transactionHash: REPLACEMENT }))
    })
    await submit()
    expect(saved().status).toBe('confirmed')
    expect(saved().depositEvent?.transactionHash).toBe(REPLACEMENT)
    expect(saved().transactions).toEqual([
      { step: 'deposit', hash: HASH, status: 'replaced' },
      { step: 'deposit', hash: REPLACEMENT, status: 'confirmed' },
    ])
  })
  it('does not confuse a wallet cancellation with a deposit', async () => {
    rpc.receipt.mockImplementationOnce(({ onReplaced }) => {
      onReplaced({ transaction: { hash: REPLACEMENT } })
      return Promise.resolve(receipt({ transactionHash: REPLACEMENT, logs: [] }))
    })
    rpc.transaction.mockResolvedValueOnce({ from: setup.sourceOwner, to: setup.sourceOwner, value: 0n, input: '0x' })
    await submit()
    expect(saved().status).toBe('failed')
    expect(saved().depositEvent).toBeUndefined()
    expect(canSubmitDeposit(saved())).toBe(true)
  })
  it('blocks simultaneous actions across tabs', async () => {
    let finish!: (hash: Hash) => void
    rpc.write.mockImplementationOnce(
      () =>
        new Promise<Hash>(resolve => {
          finish = resolve
        }),
    )
    const first = submit()
    await vi.waitFor(() => expect(rpc.write).toHaveBeenCalledOnce())
    await expect(submit()).rejects.toThrow('another tab')
    finish(HASH)
    await first
    expect(rpc.write).toHaveBeenCalledOnce()
  })
  it('fails before requesting a signature if browser storage cannot persist', async () => {
    const broken = {
      ...context,
      storage: {
        ...storage,
        setItem: () => {
          throw new Error('Quota exceeded')
        },
      },
    }
    await expect(submitDepositAction(broken, setup, '1', 'deposit')).rejects.toThrow('Quota')
    expect(rpc.write).not.toHaveBeenCalled()
  })
  it('retains a returned HASH in memory if saving it fails', async () => {
    const broken = {
      ...context,
      storage: {
        ...storage,
        setItem: (key: string, value: string) => {
          if (value.includes(HASH)) throw new Error('Storage failed after broadcast')
          storage.setItem(key, value)
        },
      },
    }
    await expect(submitDepositAction(broken, setup, '1.000001', 'deposit')).rejects.toThrow('Storage failed')
    expect(current?.transactions[0].hash).toBe(HASH)
    expect(canSubmitDeposit(saved())).toBe(false)
    expect(saved().status).toBe('signing')
  })
  it('requires the saved deployment, recipient, and amount', async () => {
    const op = createDepositOperation(setup, 1_000_001n)
    storage.setItem(DEPOSIT_STORAGE_KEY, JSON.stringify(op))
    await expect(
      submitDepositAction(context, { ...setup, recipient: setup.sourceOwner }, '1.000001', 'deposit'),
    ).rejects.toThrow('same wallets')
    await expect(submitDepositAction(context, setup, '2', 'deposit')).rejects.toThrow('same wallets')
    expect(rpc.write).not.toHaveBeenCalled()
  })
  it('blocks corrupt saved records rather than replacing them', async () => {
    storage.setItem(DEPOSIT_STORAGE_KEY, '{broken')
    await expect(submit()).rejects.toThrow('load your previous transfer')
    expect(rpc.write).not.toHaveBeenCalled()
    expect(storage.getItem(DEPOSIT_STORAGE_KEY)).toBe('{broken')
  })
  it.each([
    { version: 2 },
    { token: setup.recipient },
    { depository: setup.recipient },
    { amount: '1.5' },
    { status: 'pending', transactions: [] },
    { status: 'confirmed', depositEvent: { transactionHash: HASH, blockNumber: '100', logIndex: 3 } },
  ])('rejects invalid persisted operation fields: %j', fields => {
    storage.setItem(DEPOSIT_STORAGE_KEY, JSON.stringify({ ...createDepositOperation(setup, 1n), ...fields }))
    expect(() => saved()).toThrow('load your previous transfer')
  })
  it('keeps an interrupted signing request blocked after reload', async () => {
    storage.setItem(
      DEPOSIT_STORAGE_KEY,
      JSON.stringify({ ...createDepositOperation(setup, 1_000_001n), status: 'signing' }),
    )
    await expect(submit()).rejects.toThrow('previous transfer')
    expect(rpc.write).not.toHaveBeenCalled()
  })
  it('fails closed when the browser cannot coordinate tabs', async () => {
    vi.stubGlobal('navigator', {})
    await expect(submit()).rejects.toThrow('supported browser')
    expect(rpc.write).not.toHaveBeenCalled()
  })
})
