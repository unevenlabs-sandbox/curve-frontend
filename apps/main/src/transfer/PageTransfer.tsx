import { useState } from 'react'
import { useConnection, useSwitchChain, WagmiProvider } from 'wagmi'
import { useWallet } from '@evm-ui/features/connect-wallet/lib/useWallet'
import { useWagmiConfig } from '@evm-ui/features/connect-wallet/lib/wagmi/useWagmiConfig'
import { WagmiConnectModal } from '@evm-ui/features/connect-wallet/ui/WagmiConnectModal'
import { shortenAddress } from '@evm-ui/utils'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import InputLabel from '@mui/material/InputLabel'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { HeadContent, Link as RouterLink } from '@tanstack/react-router'
import { Loading } from '@ui/components/Loading'
import { Select } from '@ui/components/Select'
import { ConnectWalletButton } from '@ui/features/connect-wallet/ConnectWalletButton'
import { FormContent } from '@ui/features/forms/components/FormContent'
import { PageLayout } from '@ui/features/layout/PageLayout'
import { SizesAndSpaces } from '@ui/features/themes/design/1_sizes_spaces'
import { FUNDING_DEPLOYMENTS, FUNDING_SOURCES, FUNDING_SOURCE_CHAIN_IDS } from './deployments'
import { DepositForm } from './DepositForm'
import {
  isFundingSetupConfirmed,
  isValidRelayRecipient,
  validateFundingSetup,
  type FundingSetup,
} from './funding-setup'
import { useDepositOperation } from './useDepositOperation'

const { Spacing } = SizesAndSpaces

const FundingWalletSetup = () => {
  const { address, chainId, status, isConnected, isConnecting, isReconnecting } = useConnection()
  const { connect, disconnect } = useWallet()
  const { mutateAsync: switchChain, isPending: isSwitching } = useSwitchChain()
  const deposit = useDepositOperation()
  const [deploymentId, setDeploymentId] = useState(deposit.operation?.setup.deploymentId ?? 'dev')
  const [sourceChainId, setSourceChainId] = useState<number>(deposit.operation?.setup.sourceChainId ?? 8453)
  const [recipient, setRecipient] = useState(deposit.operation?.setup.recipient ?? '')
  const [confirmed, setConfirmed] = useState<FundingSetup>()
  const [error, setError] = useState<string>()
  const [recipientTouched, setRecipientTouched] = useState(false)
  const [walletChanged, setWalletChanged] = useState(false)
  const walletKey = `${address}:${chainId}:${status}`
  const [previousWalletKey, setPreviousWalletKey] = useState(walletKey)
  // Invalidate before rendering; retain the entered recipient when the connected wallet changes.
  if (previousWalletKey !== walletKey) {
    setPreviousWalletKey(walletKey)
    setConfirmed(undefined)
    setError(undefined)
    if (confirmed) setWalletChanged(true)
  }
  const busy = isConnecting || isReconnecting || isSwitching
  const setupLocked = deposit.busy || !!deposit.operation || !!deposit.storageError
  const validation = validateFundingSetup({
    deploymentId,
    sourceChainId,
    walletChainId: chainId,
    sourceOwner: isConnected && !busy ? address : undefined,
    recipient,
  })
  const isConfirmed = isFundingSetupConfirmed(confirmed, validation.setup)
  const wrongNetwork = isConnected && chainId !== sourceChainId
  const source = FUNDING_SOURCES.find(source => source.id === sourceChainId)
  const sourceUnavailable = !source?.deployments.includes(deploymentId)

  const onSwitchNetwork = async () => {
    setError(undefined)
    try {
      await switchChain({ chainId: sourceChainId })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not switch networks. Switch in your wallet and retry.')
    }
  }

  return (
    <PageLayout
      userAddress={address}
      header={
        <Stack direction="row" sx={{ padding: Spacing.md, justifyContent: 'space-between', alignItems: 'center' }}>
          <Link component={RouterLink} to="/dex/ethereum/pools">
            Curve pools
          </Link>
          {isConnected ? (
            <Button onClick={() => void disconnect()} size="small">
              Disconnect {shortenAddress(address)}
            </Button>
          ) : (
            <ConnectWalletButton
              connect={connect}
              isConnecting={isConnecting || isReconnecting}
              isConnected={isConnected}
            />
          )}
        </Stack>
      }
      connectModal={<WagmiConnectModal />}
      footer={null}
    >
      <Stack sx={{ maxWidth: 560, marginInline: 'auto', padding: Spacing.md, gap: Spacing.md }}>
        <Typography variant="headingXl" component="h1">
          Fund Relay wallet
        </Typography>
        <Typography>Move USDC to Relay Chain to use in Curve pools.</Typography>
        <FormContent>
          <FormControl fullWidth>
            <InputLabel id="deployment-label">Environment</InputLabel>
            <Select
              labelId="deployment-label"
              label="Environment"
              value={deploymentId}
              disabled={setupLocked}
              onChange={event => {
                setDeploymentId(String(event.target.value))
                setConfirmed(undefined)
              }}
            >
              {FUNDING_DEPLOYMENTS.map(deployment => (
                <MenuItem key={deployment.id} value={deployment.id}>
                  {deployment.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel id="source-asset-label">From</InputLabel>
            <Select
              labelId="source-asset-label"
              label="From"
              value={sourceChainId}
              disabled={busy || setupLocked}
              onChange={event => {
                setSourceChainId(Number(event.target.value))
                setConfirmed(undefined)
                setError(undefined)
              }}
            >
              {FUNDING_SOURCES.map(source => (
                <MenuItem key={source.id} value={source.id} disabled={!source.deployments.includes(deploymentId)}>
                  {source.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {sourceUnavailable && <Alert severity="warning">{validation.error}</Alert>}
          <TextField
            label="Connected wallet"
            value={address ?? ''}
            placeholder="Connect your wallet"
            slotProps={{ input: { readOnly: true } }}
            fullWidth
          />
          {walletChanged && <Alert severity="warning">Wallet or network changed. Confirm the addresses again.</Alert>}
          {wrongNetwork && !sourceUnavailable && (
            <Alert severity="warning">Your wallet is on a different network.</Alert>
          )}
          {wrongNetwork && !sourceUnavailable && (
            <Button loading={isSwitching} disabled={busy} onClick={() => void onSwitchNetwork()}>
              Switch network
            </Button>
          )}
          <TextField
            label="Relay wallet address"
            value={recipient}
            disabled={setupLocked}
            placeholder="0x…"
            fullWidth
            onBlur={() => setRecipientTouched(true)}
            onChange={event => {
              setRecipient(event.target.value)
              setConfirmed(undefined)
            }}
            error={recipientTouched && !isValidRelayRecipient(recipient)}
            helperText={
              recipientTouched && !isValidRelayRecipient(recipient)
                ? 'Enter a valid Relay wallet address.'
                : 'Use a Relay Chain wallet you control.'
            }
          />
          <Button
            variant="text"
            disabled={!isConnected || busy || setupLocked}
            onClick={() => {
              setRecipient(address ?? '')
              setConfirmed(undefined)
            }}
          >
            Use this wallet
          </Button>
          <FormControlLabel
            control={
              <Checkbox
                checked={isConfirmed}
                disabled={!validation.setup || busy || deposit.busy}
                onChange={event => {
                  setConfirmed(event.target.checked ? validation.setup : undefined)
                  setWalletChanged(false)
                }}
              />
            }
            label="I’ve checked the addresses and control this Relay wallet."
          />
          {error && <Alert severity="error">{error}</Alert>}
          <DepositForm
            setup={isConfirmed ? validation.setup : undefined}
            sourceChainId={sourceChainId}
            deploymentId={deploymentId}
            deposit={deposit}
            onRestore={() => {
              if (!deposit.operation) return
              const { setup } = deposit.operation
              setDeploymentId(setup.deploymentId)
              setSourceChainId(setup.sourceChainId)
              setRecipient(setup.recipient)
              setConfirmed(undefined)
            }}
          />
        </FormContent>
      </Stack>
    </PageLayout>
  )
}

export const PageTransfer = () => {
  const config = useWagmiConfig(FUNDING_SOURCE_CHAIN_IDS)
  return config ? (
    <WagmiProvider config={config}>
      <HeadContent />
      <FundingWalletSetup />
    </WagmiProvider>
  ) : (
    <Loading />
  )
}
