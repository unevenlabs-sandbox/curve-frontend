import { useState } from 'react'
import { erc20Abi, formatUnits } from 'viem'
import { useConfig, useReadContracts } from 'wagmi'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { maybe } from '@primitives/objects.utils'
import { FUNDING_DEPLOYMENTS, FUNDING_SOURCES, getDepositRoute } from './deployments'
import { checkDepositTransaction, submitDepositAction } from './deposit-actions'
import { canSubmitDeposit, parseDepositAmount } from './deposit-operation'
import { isFundingSetupConfirmed, type FundingSetup } from './funding-setup'
import type { useDepositOperation } from './useDepositOperation'

export const DepositForm = ({
  setup,
  sourceChainId,
  deploymentId,
  deposit,
  onRestore,
}: {
  setup?: FundingSetup
  sourceChainId: number
  deploymentId: string
  deposit: ReturnType<typeof useDepositOperation>
  onRestore: () => void
}) => {
  const config = useConfig()
  const { operation: op, storageError, busy, setBusy, onChange } = deposit
  const [amount, setAmount] = useState(() => (op ? formatUnits(BigInt(op.amount), 6) : ''))
  const [error, setError] = useState<string>()
  const value = op ? formatUnits(BigInt(op.amount), 6) : amount
  const route = getDepositRoute(deploymentId, sourceChainId)
  const common = { chainId: sourceChainId, address: route?.token, abi: erc20Abi } as const
  const funds = useReadContracts({
    contracts:
      setup && route
        ? ([
            { ...common, functionName: 'balanceOf', args: [setup.sourceOwner] },
            { ...common, functionName: 'allowance', args: [setup.sourceOwner, route.depository] },
            { ...common, functionName: 'decimals' },
          ] as const)
        : undefined,
    allowFailure: false,
    query: { enabled: !!setup && !!route, staleTime: 0, refetchInterval: 15_000 },
  })
  const [balance, allowance, decimals] = funds.data ?? []
  let amountError: string | undefined
  let rawAmount: bigint | undefined
  try {
    rawAmount = parseDepositAmount(value)
    if ((!op || canSubmitDeposit(op)) && balance != null && rawAmount > balance)
      amountError = 'Not enough USDC in this wallet.'
  } catch (error) {
    amountError = error instanceof Error ? error.message : 'Enter a valid USDC amount.'
  }
  const needsApproval = allowance != null && rawAmount != null && allowance < rawAmount
  const pending = op?.transactions.some(tx => tx.status === 'pending')
  const canSubmit =
    !!setup &&
    !!route &&
    !!funds.data &&
    decimals === 6 &&
    !funds.isError &&
    !amountError &&
    !storageError &&
    !busy &&
    (!op || isFundingSetupConfirmed(op.setup, setup)) &&
    (!op || canSubmitDeposit(op))
  const run = async (checkOnly = false) => {
    setBusy(true)
    setError(undefined)
    try {
      const context = { config, storage: window.localStorage, onChange }
      if (!context.storage) throw new Error('Enable browser storage to continue.')
      if (checkOnly) await checkDepositTransaction(context)
      else if (setup) await submitDepositAction(context, setup, value, needsApproval ? 'approval' : 'deposit')
      await funds.refetch()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not complete the transfer.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack sx={{ gap: 2 }}>
      <Alert severity="info">Relay wallet delivery is not available yet. Sending USDC completes the first step.</Alert>
      {!route && <Alert severity="info">Transfers from this asset are not available yet.</Alert>}
      <TextField
        label="Amount (USDC)"
        placeholder="0.00"
        value={value}
        disabled={busy || !!op || !route}
        fullWidth
        onChange={event => setAmount(event.target.value)}
        error={!!value && !!amountError}
        helperText={
          value && amountError ? amountError : maybe(balance, balance => `Available: ${formatUnits(balance, 6)} USDC`)
        }
        slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 85 } }}
      />
      {setup && route && funds.isPending && <Typography>Checking your balance…</Typography>}
      {decimals != null && decimals !== 6 && <Alert severity="error">Could not verify USDC on this network.</Alert>}
      {setup && route && funds.isError && (
        <Alert severity="error">
          Could not check your USDC balance. <Button onClick={() => void funds.refetch()}>Retry</Button>
        </Alert>
      )}
      {op && (
        <Stack sx={{ gap: 1, overflowWrap: 'anywhere' }}>
          <Typography variant="bodyS">
            {formatUnits(BigInt(op.amount), 6)} USDC ·{' '}
            {FUNDING_SOURCES.find(source => source.id === op.setup.sourceChainId)?.name} ·{' '}
            {FUNDING_DEPLOYMENTS.find(deployment => deployment.id === op.setup.deploymentId)?.label}
          </Typography>
          <Typography variant="bodyS">From wallet: {op.setup.sourceOwner}</Typography>
          <Typography variant="bodyS">Relay wallet: {op.setup.recipient}</Typography>
          {op.status !== 'confirmed' && !isFundingSetupConfirmed(op.setup, setup) && (
            <Alert severity="warning">Reconnect the wallet and network used for this transfer.</Alert>
          )}
          {op.transactions.map(tx => (
            <Typography key={tx.hash} variant="bodyS">
              {tx.step === 'approval' ? 'Approval' : 'USDC transfer'} ({tx.status === 'reverted' ? 'failed' : tx.status}
              ):{' '}
              <Link
                href={`${config.chains.find(chain => chain.id === op.setup.sourceChainId)?.blockExplorers?.default.url}/tx/${tx.hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View transaction
              </Link>
            </Typography>
          ))}
          {!setup && op.status !== 'confirmed' && (
            <Button disabled={busy} onClick={onRestore}>
              Use saved wallets
            </Button>
          )}
        </Stack>
      )}
      {op?.status === 'signing' && <Alert severity="info">Check your wallet for the pending request.</Alert>}
      {pending && <Alert severity="info">Waiting for confirmation…</Alert>}
      {op?.status === 'unknown' && (
        <Alert severity="warning">Submission could not be confirmed. Check your wallet before sending again.</Alert>
      )}
      {(storageError || error || op?.error) && <Alert severity="error">{storageError ?? error ?? op?.error}</Alert>}
      {op?.status === 'confirmed' ? (
        <Alert severity="success">USDC sent. Delivery to your Relay wallet is not available yet.</Alert>
      ) : pending ? (
        <Button loading={busy} disabled={busy || !!storageError} onClick={() => void run(true)}>
          Check status
        </Button>
      ) : (
        <Button variant="contained" loading={busy} disabled={!canSubmit} onClick={() => void run()}>
          {needsApproval ? 'Approve USDC' : 'Send USDC'}
        </Button>
      )}
    </Stack>
  )
}
