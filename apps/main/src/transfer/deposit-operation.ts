import { isAddressEqual, isHash, maxUint256, parseUnits, type Hash } from 'viem'
import { getDepositRoute } from './deployments'
import { isFundingSetupConfirmed, validateFundingSetup, type FundingSetup } from './funding-setup'

export const DEPOSIT_STORAGE_KEY = 'relay-funding-deposit-v1'
export const DEPOSIT_LOCK = 'relay-funding-deposit'
const STATUSES = ['ready', 'signing', 'pending', 'rejected', 'failed', 'unknown', 'confirmed'] as const
export type DepositStep = 'approval' | 'deposit'
export type DepositTransaction = {
  step: DepositStep
  hash: Hash
  status: 'pending' | 'confirmed' | 'reverted' | 'replaced'
}
export type DepositOperation = {
  version: 1
  id: string
  createdAt: number
  setup: FundingSetup
  token: `0x${string}`
  depository: `0x${string}`
  currency: 'usdc'
  amount: string
  status: (typeof STATUSES)[number]
  step: DepositStep
  transactions: DepositTransaction[]
  depositEvent?: { transactionHash: Hash; blockNumber: string; logIndex: number }
  error?: string
}

export const parseDepositAmount = (value: string): bigint => {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Enter a valid USDC amount.')
  if ((value.split('.')[1]?.length ?? 0) > 6) throw new Error('Use no more than 6 digits after the decimal point.')
  const amount = parseUnits(value, 6)
  if (amount <= 0n) throw new Error('Enter an amount greater than zero.')
  if (amount > maxUint256) throw new Error('This amount is too large.')
  return amount
}

export const createDepositOperation = (setup: FundingSetup, amount: bigint): DepositOperation => {
  const validated = validateFundingSetup({ ...setup, walletChainId: setup.sourceChainId }).setup
  if (!isFundingSetupConfirmed(setup, validated) || amount <= 0n || amount > maxUint256)
    throw new Error('Check your wallets and amount before continuing.')
  const route = getDepositRoute(setup.deploymentId, setup.sourceChainId)
  if (!route) throw new Error('Transfers from this asset are not available yet.')
  return {
    version: 1,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    setup,
    ...route,
    currency: 'usdc',
    amount: amount.toString(),
    status: 'ready',
    step: 'approval',
    transactions: [],
  }
}

// Reject malformed or obsolete records; never silently turn one into a fresh deposit.
export const readDepositOperation = (storage: Pick<Storage, 'getItem'>): DepositOperation | undefined => {
  const raw = storage.getItem(DEPOSIT_STORAGE_KEY)
  if (raw == null) return
  try {
    const op = JSON.parse(raw) as DepositOperation
    const setup = validateFundingSetup({ ...op.setup, walletChainId: op.setup.sourceChainId }).setup
    const route = getDepositRoute(op.setup.deploymentId, op.setup.sourceChainId)
    if (
      op.version !== 1 ||
      typeof op.id !== 'string' ||
      !op.id ||
      !Number.isFinite(op.createdAt) ||
      !isFundingSetupConfirmed(op.setup, setup) ||
      !route ||
      !isAddressEqual(op.token, route.token) ||
      !isAddressEqual(op.depository, route.depository) ||
      op.currency !== 'usdc' ||
      typeof op.amount !== 'string' ||
      !/^\d+$/.test(op.amount) ||
      BigInt(op.amount) <= 0n ||
      BigInt(op.amount) > maxUint256 ||
      !STATUSES.includes(op.status) ||
      !['approval', 'deposit'].includes(op.step) ||
      !Array.isArray(op.transactions) ||
      !op.transactions.every(
        tx =>
          ['approval', 'deposit'].includes(tx.step) &&
          isHash(tx.hash) &&
          ['pending', 'confirmed', 'reverted', 'replaced'].includes(tx.status),
      ) ||
      (op.error != null && typeof op.error !== 'string') ||
      (op.status === 'pending' && !op.transactions.some(tx => tx.status === 'pending')) ||
      (op.status === 'confirmed' &&
        (!op.depositEvent ||
          op.step !== 'deposit' ||
          !isHash(op.depositEvent.transactionHash) ||
          !/^\d+$/.test(op.depositEvent.blockNumber) ||
          !Number.isInteger(op.depositEvent.logIndex) ||
          op.depositEvent.logIndex < 0 ||
          !op.transactions.some(
            tx => tx.step === 'deposit' && tx.status === 'confirmed' && tx.hash === op.depositEvent?.transactionHash,
          )))
    )
      throw new Error('Invalid operation')
    return op
  } catch {
    throw new Error(
      'Could not load your previous transfer. Keep your browser data and check the transaction in your wallet.',
    )
  }
}

export const canSubmitDeposit = (op: DepositOperation) =>
  ['ready', 'rejected', 'failed'].includes(op.status) &&
  !op.depositEvent &&
  !op.transactions.some(tx => tx.status === 'pending' || (tx.step === 'deposit' && tx.status === 'confirmed'))

export const withDepositLock = async <T>(action: () => Promise<T>): Promise<T> => {
  if (!navigator.locks) throw new Error('This browser cannot safely submit transfers. Try a supported browser.')
  return navigator.locks.request(DEPOSIT_LOCK, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('A transfer is running in another tab. Wait for it to finish.')
    return action()
  })
}
