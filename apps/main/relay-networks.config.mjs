import { isAddress } from 'viem'
import { arbitrum, base, ethereum, polygon } from '@relay-protocol/settlement-networks'

// Node-only build configuration. Expose contract addresses, never RPC URLs or overrides.
export const relayDepositories = Object.fromEntries(
  [base, arbitrum, polygon, ethereum].map(network => [
    Number(network.chainId),
    Object.fromEntries(
      ['dev', 'stag', 'prod'].map(environment => {
        const address = network.contracts[environment]?.depository
        if (!address || !isAddress(address)) {
          throw new Error(`Missing Depository for ${network.slug}/${environment}`)
        }
        return [environment, address.toLowerCase()]
      }),
    ),
  ]),
)
