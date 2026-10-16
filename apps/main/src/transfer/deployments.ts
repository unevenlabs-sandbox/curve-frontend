import type { Address } from 'viem'
import { Chain } from '@primitives/network.utils'

// Hub addresses: settlement-protocol @ 9c9cbb65df48e717f011a2809032820df77ebfcf,
// smart-contracts/deployments/contracts/{dev,stag,prod}.json.
// Keep this manifest pinned: settlement-networks does not include the current dev/stag Hubs.
// Keep environment identity separate from chain ID: staging and production share Relay Chain.
export const FUNDING_DEPLOYMENTS = [
  { id: 'dev', label: 'Development', relayChainId: 537724, hub: '0xa884543c91156098b2e50ae17c3840770b7b55f5' },
  { id: 'stag', label: 'Staging', relayChainId: 537713, hub: '0x3c0be5a7f32a7dfb70c156b81eb747d0e5287f30' },
  { id: 'prod', label: 'Production', relayChainId: 537713, hub: '0xddd361727c22a01eb137880678a20b0beae69318' },
] as const satisfies readonly { id: string; label: string; relayChainId: number; hub: Address }[]

type FundingSource = {
  id: number
  name: string
  assetChainId: string
  ownerChainId: string
  deployments: readonly string[]
}

const EVM_DEPLOYMENTS = ['dev', 'stag', 'prod'] as const

// Oracle configs/chains.mainnets.{dev,stag,prod}.json define the asset and physical owner chains.
// Arc Gateway's asset is arc-gateway; its wallet and alias owner use the physical Arc chain.
export const FUNDING_SOURCES: readonly FundingSource[] = [
  { id: Chain.Base, name: 'Base USDC', assetChainId: 'base', ownerChainId: 'base', deployments: EVM_DEPLOYMENTS },
  {
    id: Chain.Arbitrum,
    name: 'Arbitrum USDC',
    assetChainId: 'arbitrum',
    ownerChainId: 'arbitrum',
    deployments: EVM_DEPLOYMENTS,
  },
  {
    id: Chain.Polygon,
    name: 'Polygon USDC',
    assetChainId: 'polygon',
    ownerChainId: 'polygon',
    deployments: EVM_DEPLOYMENTS,
  },
  {
    id: Chain.Ethereum,
    name: 'Ethereum USDC',
    assetChainId: 'ethereum',
    ownerChainId: 'ethereum',
    deployments: EVM_DEPLOYMENTS,
  },
  {
    id: Chain.Arc,
    name: 'Arc Gateway USDC',
    assetChainId: 'arc-gateway',
    ownerChainId: 'arc',
    deployments: ['stag', 'prod'],
  },
]

export const FUNDING_SOURCE_CHAIN_IDS = FUNDING_SOURCES.map(source => source.id)

// Native USDC, with six decimals. Also checked against Oracle mainnet configs
// and source-chain RPC on 2026-10-16; do not substitute bridged USDC.
const USDC: Record<number, Address> = {
  [Chain.Base]: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  [Chain.Arbitrum]: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  [Chain.Polygon]: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  [Chain.Ethereum]: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
}

export const getDepositRoute = (deploymentId: string, sourceChainId: number) => {
  const deployment = FUNDING_DEPLOYMENTS.find(deployment => deployment.id === deploymentId)
  const token = USDC[sourceChainId]
  const depository = deployment ? __RELAY_DEPOSITORIES__[sourceChainId]?.[deployment.id] : undefined
  return token && depository ? { token, depository } : undefined
}
