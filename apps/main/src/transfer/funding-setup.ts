import { getAddress, isAddress, zeroAddress, type Address } from 'viem'
import { FUNDING_DEPLOYMENTS, FUNDING_SOURCES } from './deployments'

export type FundingSetup = {
  deploymentId: string
  hub: Address
  relayChainId: number
  sourceChainId: number
  assetChainId: string
  ownerChainId: string
  sourceOwner: Address
  recipient: Address
}

export const isValidRelayRecipient = (recipient: string) =>
  isAddress(recipient) && recipient.toLowerCase() !== zeroAddress

export const validateFundingSetup = ({
  deploymentId,
  sourceChainId,
  walletChainId,
  sourceOwner,
  recipient,
}: {
  deploymentId: string
  sourceChainId: number
  walletChainId?: number
  sourceOwner?: Address
  recipient: string
}): { setup?: FundingSetup; error?: string } => {
  const deployment = FUNDING_DEPLOYMENTS.find(deployment => deployment.id === deploymentId)
  if (!deployment) return { error: 'Select an available environment.' }
  const source = FUNDING_SOURCES.find(source => source.id === sourceChainId)
  if (!source) return { error: 'Select an available network.' }
  if (!source.deployments.includes(deploymentId))
    return { error: `${source.name} is not available in ${deployment.label}.` }
  if (!sourceOwner) return { error: 'Connect your wallet.' }
  if (walletChainId !== sourceChainId) return { error: 'Switch your wallet to the selected network.' }
  if (!isValidRelayRecipient(recipient)) return { error: 'Enter a valid Relay wallet address.' }
  return {
    setup: {
      deploymentId: deployment.id,
      hub: getAddress(deployment.hub),
      relayChainId: deployment.relayChainId,
      sourceChainId,
      assetChainId: source.assetChainId,
      ownerChainId: source.ownerChainId,
      sourceOwner: getAddress(sourceOwner),
      recipient: getAddress(recipient),
    },
  }
}

export const isFundingSetupConfirmed = (confirmed: FundingSetup | undefined, current: FundingSetup | undefined) =>
  !!confirmed &&
  !!current &&
  confirmed.deploymentId === current.deploymentId &&
  confirmed.hub === current.hub &&
  confirmed.relayChainId === current.relayChainId &&
  confirmed.sourceChainId === current.sourceChainId &&
  confirmed.assetChainId === current.assetChainId &&
  confirmed.ownerChainId === current.ownerChainId &&
  confirmed.sourceOwner === current.sourceOwner &&
  confirmed.recipient === current.recipient
