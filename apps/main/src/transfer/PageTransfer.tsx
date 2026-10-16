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
import FormHelperText from '@mui/material/FormHelperText'
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
import {
  isFundingSetupConfirmed,
  isValidRelayRecipient,
  validateFundingSetup,
  type FundingSetup,
} from './funding-setup'

const { Spacing } = SizesAndSpaces

const FundingWalletSetup = () => {
  const { address, chainId, status, isConnected, isConnecting, isReconnecting } = useConnection()
  const { connect, disconnect } = useWallet()
  const { mutateAsync: switchChain, isPending: isSwitching } = useSwitchChain()
  const [deploymentId, setDeploymentId] = useState('dev')
  const [sourceChainId, setSourceChainId] = useState<number>(8453)
  const [recipient, setRecipient] = useState('')
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
        <Typography>Choose the wallet holding your USDC and the Relay wallet that will receive it.</Typography>
        <FormContent>
          <FormControl fullWidth>
            <InputLabel id="deployment-label">Deployment</InputLabel>
            <Select
              labelId="deployment-label"
              label="Deployment"
              value={deploymentId}
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
            {deploymentId === 'dev' && (
              <FormHelperText>Choose Staging or Production to set up Arc Gateway USDC.</FormHelperText>
            )}
          </FormControl>
          <FormControl fullWidth>
            <InputLabel id="source-asset-label">Source asset</InputLabel>
            <Select
              labelId="source-asset-label"
              label="Source asset"
              value={sourceChainId}
              disabled={busy}
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
            label="Source wallet"
            value={address ?? ''}
            placeholder="Connect an EVM wallet"
            slotProps={{ input: { readOnly: true } }}
            fullWidth
          />
          {walletChanged && (
            <Alert severity="warning">
              The source wallet or network changed. Check both addresses and confirm again.
            </Alert>
          )}
          {wrongNetwork && !sourceUnavailable && (
            <Alert severity="warning">
              Your source wallet is on a different network. Switch to the selected source network to confirm this setup.
            </Alert>
          )}
          {wrongNetwork && !sourceUnavailable && (
            <Button loading={isSwitching} disabled={busy} onClick={() => void onSwitchNetwork()}>
              Switch source network
            </Button>
          )}
          <TextField
            label="Receiving Relay EVM address"
            value={recipient}
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
                ? 'Enter a valid, nonzero EVM address.'
                : 'Use a wallet you control on Relay Chain. The receiving address stays fixed when you change the source wallet.'
            }
          />
          <Button
            variant="text"
            disabled={!isConnected || busy}
            onClick={() => {
              setRecipient(address ?? '')
              setConfirmed(undefined)
            }}
          >
            Use connected address
          </Button>
          <FormControlLabel
            control={
              <Checkbox
                checked={isConfirmed}
                disabled={!validation.setup || busy}
                onChange={event => {
                  setConfirmed(event.target.checked ? validation.setup : undefined)
                  setWalletChanged(false)
                }}
              />
            }
            label="I control this Relay wallet and have checked both addresses."
          />
          {error && <Alert severity="error">{error}</Alert>}
          {isConfirmed && (
            <Alert severity="success">
              Wallet setup confirmed for {FUNDING_DEPLOYMENTS.find(deployment => deployment.id === deploymentId)?.label}
              .
            </Alert>
          )}
          <Alert severity="info">
            USDC deposits are not available yet. This page currently sets up the wallets for funding.
          </Alert>
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
