import {
  encodeFunctionData,
  erc20Abi,
  isAddressEqual,
  isHash,
  parseEventLogs,
  zeroHash,
  type Abi,
  type Address,
  type Hash,
} from 'viem'
import { RelayDepository } from '@relay-protocol/settlement-abis'
import { getConnection, getPublicClient, readContract, simulateContract, writeContract, type Config } from '@wagmi/core'
import { getDepositRoute } from './deployments'
import {
  canSubmitDeposit,
  createDepositOperation,
  DEPOSIT_STORAGE_KEY,
  parseDepositAmount,
  readDepositOperation,
  withDepositLock,
  type DepositOperation,
  type DepositStep,
} from './deposit-operation'
import { isFundingSetupConfirmed, type FundingSetup } from './funding-setup'

type DepositContext = {
  config: Config
  storage: Pick<Storage, 'getItem' | 'setItem'>
  onChange: (operation: DepositOperation) => void
}

// The published JSON ABI widens Solidity literals in its declaration file.
const depositoryAbi = RelayDepository as Abi

const saveOperation = ({ storage, onChange }: DepositContext, op: DepositOperation) => {
  // Retain a returned hash in memory even if storage subsequently fails.
  onChange(op)
  storage.setItem(DEPOSIT_STORAGE_KEY, JSON.stringify(op))
}

export const readDepositFunds = async (config: Config, setup: FundingSetup) => {
  const route = getDepositRoute(setup.deploymentId, setup.sourceChainId)
  if (!route) throw new Error('Transfers from this asset are not available yet.')
  const common = { chainId: setup.sourceChainId, address: route.token, abi: erc20Abi } as const
  const [balance, allowance, decimals] = await Promise.all([
    readContract(config, { ...common, functionName: 'balanceOf', args: [setup.sourceOwner] }),
    readContract(config, { ...common, functionName: 'allowance', args: [setup.sourceOwner, route.depository] }),
    readContract(config, { ...common, functionName: 'decimals' }),
  ])
  if (decimals !== 6) throw new Error('Could not verify USDC on this network.')
  return { balance, allowance }
}

const assertSourceWallet = async (config: Config, setup: FundingSetup) => {
  const connection = getConnection(config)
  const connector = connection.connector
  if (
    !connection.isConnected ||
    !connector ||
    !connection.address ||
    !isAddressEqual(connection.address, setup.sourceOwner)
  )
    throw new Error('Reconnect the wallet used for this transfer.')
  const [accounts, chainId] = await Promise.all([connector.getAccounts(), connector.getChainId()])
  if (!accounts[0] || !isAddressEqual(accounts[0], setup.sourceOwner) || chainId !== setup.sourceChainId)
    throw new Error('Select the wallet and network used for this transfer.')
}

const transactionRequest = (
  op: DepositOperation,
  step: DepositStep,
): {
  chainId: number
  account: Address
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
} => {
  const common = { chainId: op.setup.sourceChainId, account: op.setup.sourceOwner }
  return step === 'approval'
    ? ({
        ...common,
        address: op.token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [op.depository, BigInt(op.amount)],
      } as const)
    : ({
        ...common,
        address: op.depository,
        abi: depositoryAbi,
        functionName: 'depositErc20',
        args: [op.setup.sourceOwner, op.token, BigInt(op.amount), zeroHash],
      } as const)
}

const isRejected = (error: unknown): boolean =>
  typeof error === 'object' &&
  error != null &&
  (('code' in error && error.code === 4001) || ('cause' in error && error.cause !== error && isRejected(error.cause)))

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Could not complete the transfer.')

// Receipt checks also run after reload, without requiring the original wallet to remain connected.
const confirmTransaction = async (context: DepositContext, initial: DepositOperation) => {
  let op = initial
  const tx = op.transactions.findLast(tx => tx.status === 'pending')
  if (!tx) throw new Error('There is no saved transaction to check.')
  const client = getPublicClient(context.config, { chainId: op.setup.sourceChainId })
  if (!client) throw new Error('This network is unavailable. Try again later.')
  const receipt = await client.waitForTransactionReceipt({
    hash: tx.hash,
    timeout: 180_000,
    onReplaced: ({ transaction }) => {
      op = {
        ...op,
        transactions: [
          ...op.transactions.map(item => (item.status === 'pending' ? { ...item, status: 'replaced' as const } : item)),
          { step: tx.step, hash: transaction.hash.toLowerCase() as Hash, status: 'pending' },
        ],
      }
      saveOperation(context, op)
    },
  })
  const receiptHash = receipt.transactionHash.toLowerCase() as Hash
  const actual = await client.getTransaction({ hash: receiptHash })
  const request = transactionRequest(op, tx.step)
  const matches =
    actual.to &&
    isAddressEqual(actual.from, op.setup.sourceOwner) &&
    isAddressEqual(actual.to, request.address) &&
    actual.value === 0n &&
    actual.input.toLowerCase() === encodeFunctionData(request).toLowerCase()
  const event =
    tx.step === 'deposit' && receipt.status === 'success' && matches
      ? parseEventLogs({ abi: depositoryAbi, eventName: 'RelayErc20Deposit', logs: receipt.logs }).find(log => {
          const args = log.args as { from: Address; token: Address; amount: bigint; id: Hash }
          return (
            isAddressEqual(log.address, op.depository) &&
            isAddressEqual(args.from, op.setup.sourceOwner) &&
            isAddressEqual(args.token, op.token) &&
            args.amount === BigInt(op.amount) &&
            args.id === zeroHash
          )
        })
      : undefined
  const succeeded = receipt.status === 'success' && matches && (tx.step === 'approval' || !!event)
  op = {
    ...op,
    status: succeeded ? (tx.step === 'deposit' ? 'confirmed' : 'ready') : 'failed',
    transactions: op.transactions.map(item =>
      item.hash.toLowerCase() === receiptHash
        ? { ...item, status: receipt.status === 'reverted' ? 'reverted' : matches ? 'confirmed' : 'replaced' }
        : item,
    ),
    ...(event && {
      depositEvent: {
        transactionHash: receiptHash,
        blockNumber: receipt.blockNumber.toString(),
        logIndex: event.logIndex,
      },
    }),
    error: succeeded ? undefined : 'The transaction failed or changed. Check your wallet before retrying.',
  }
  // Only a proven revert or cancellation makes another deposit safe.
  const cancelled =
    actual.to && isAddressEqual(actual.to, op.setup.sourceOwner) && actual.value === 0n && actual.input === '0x'
  if (tx.step === 'deposit' && receipt.status === 'success' && !event && !cancelled) op.status = 'unknown'
  saveOperation(context, op)
  return op
}

export const submitDepositAction = async (
  context: DepositContext,
  setup: FundingSetup,
  value: string,
  step: DepositStep,
) =>
  withDepositLock(async () => {
    const amount = parseDepositAmount(value)
    let op = readDepositOperation(context.storage) ?? createDepositOperation(setup, amount)
    if (!isFundingSetupConfirmed(op.setup, setup) || op.amount !== amount.toString())
      throw new Error('Continue the saved transfer with the same wallets, environment, and amount.')
    if (!canSubmitDeposit(op)) throw new Error('Check your previous transfer before sending again.')
    op = { ...op, step, status: 'ready', error: undefined }
    saveOperation(context, op)
    let requested = false
    try {
      await assertSourceWallet(context.config, setup)
      const { balance, allowance } = await readDepositFunds(context.config, setup)
      if (balance < amount) throw new Error('Not enough USDC in this wallet.')
      if (step === 'deposit' && allowance < amount) throw new Error('Approve USDC to continue.')
      if (step === 'approval' && allowance >= amount) return op
      const client = getPublicClient(context.config, { chainId: setup.sourceChainId })
      const code = await client?.getCode({ address: op.depository })
      if (!code || code === '0x') throw new Error('Transfers are unavailable on this network.')
      const request = transactionRequest(op, step)
      await simulateContract(context.config, request)
      await assertSourceWallet(context.config, setup)
      op = { ...op, status: 'signing' }
      saveOperation(context, op)
      requested = true
      const hash: Hash = await writeContract(context.config, request)
      if (!isHash(hash)) throw new Error('Could not confirm submission. Check your wallet for the transaction.')
      op = {
        ...op,
        status: 'pending',
        transactions: [...op.transactions, { step, hash: hash.toLowerCase() as Hash, status: 'pending' }],
      }
      saveOperation(context, op)
    } catch (error) {
      op = {
        ...op,
        status: requested ? (isRejected(error) ? 'rejected' : 'unknown') : 'ready',
        error: errorMessage(error),
      }
      saveOperation(context, op)
      throw error
    }
    // A receipt timeout never makes a submitted transaction safe to repeat.
    return confirmTransaction(context, op)
  })

export const checkDepositTransaction = (context: DepositContext) =>
  withDepositLock(async () => {
    const op = readDepositOperation(context.storage)
    if (!op?.transactions.some(tx => tx.status === 'pending'))
      throw new Error('There is no saved transaction to check.')
    return confirmTransaction(context, op)
  })
