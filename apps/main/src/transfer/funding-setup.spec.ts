import { getAddress, zeroAddress } from 'viem'
import { assert, describe, expect, it } from 'vitest'
import { isFundingSetupConfirmed, isValidRelayRecipient, validateFundingSetup } from './funding-setup'

const INPUT = {
  deploymentId: 'dev',
  sourceChainId: 8453,
  walletChainId: 8453,
  sourceOwner: '0x1111111111111111111111111111111111111111',
  recipient: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
} as const

describe('funding wallet setup', () => {
  it('configures Base funding with separate source and receiving addresses', () => {
    const { setup, error } = validateFundingSetup(INPUT)
    expect(error).toBeUndefined()
    expect(setup).toEqual({
      deploymentId: 'dev',
      hub: getAddress('0xa884543c91156098b2e50ae17c3840770b7b55f5'),
      relayChainId: 537724,
      sourceChainId: 8453,
      assetChainId: 'base',
      ownerChainId: 'base',
      sourceOwner: INPUT.sourceOwner,
      recipient: getAddress(INPUT.recipient),
    })
  })

  it.each([8453, 42161, 137, 1])('accepts the supported EVM source chain %s', sourceChainId => {
    expect(validateFundingSetup({ ...INPUT, sourceChainId, walletChainId: sourceChainId }).setup?.sourceChainId).toBe(
      sourceChainId,
    )
  })

  it.each(['stag', 'prod'])('keeps Arc Gateway asset and Arc owner identities separate in %s', deploymentId => {
    const result = validateFundingSetup({ ...INPUT, deploymentId, sourceChainId: 5042, walletChainId: 5042 })
    expect(result.error).toBeUndefined()
    expect(result.setup).toMatchObject({
      sourceChainId: 5042,
      assetChainId: 'arc-gateway',
      ownerChainId: 'arc',
      sourceOwner: INPUT.sourceOwner,
      recipient: getAddress(INPUT.recipient),
    })
  })

  it('blocks Arc Gateway in development instead of substituting another Gateway route', () => {
    const result = validateFundingSetup({ ...INPUT, sourceChainId: 5042, walletChainId: 5042 })
    expect(result.setup).toBeUndefined()
    expect(result.error).toContain('Arc Gateway USDC is not configured for Development')
  })

  it('requires the Arc wallet network for Arc Gateway', () => {
    const result = validateFundingSetup({ ...INPUT, deploymentId: 'stag', sourceChainId: 5042 })
    expect(result.setup).toBeUndefined()
    expect(result.error).toContain('Switch the source wallet')
  })

  it.each([{ assetChainId: 'arc' }, { ownerChainId: 'arc-gateway' }])(
    'invalidates confirmation when the Gateway asset or owner identity changes: %j',
    change => {
      const setup = validateFundingSetup({
        ...INPUT,
        deploymentId: 'prod',
        sourceChainId: 5042,
        walletChainId: 5042,
      }).setup
      assert(setup)
      expect(isFundingSetupConfirmed(setup, { ...setup, ...change })).toBe(false)
    },
  )

  it.each(['', zeroAddress, '0x1234', 'solana-wallet', '0xaBcdefabcdefabcdefabcdefabcdefabcdefabcd'])(
    'rejects invalid or zero recipients: %s',
    recipient => {
      expect(isValidRelayRecipient(recipient)).toBe(false)
      expect(validateFundingSetup({ ...INPUT, recipient }).setup).toBeUndefined()
    },
  )

  it.each([
    { deploymentId: 'unknown' },
    { sourceChainId: 10, walletChainId: 10 },
    { sourceOwner: undefined },
    { walletChainId: 1 },
    { walletChainId: undefined },
  ])('blocks an incomplete or unsupported setup: %j', change => {
    const result = validateFundingSetup({ ...INPUT, ...change })
    expect(result.setup).toBeUndefined()
    expect(result.error).toBeTruthy()
  })

  it('does not infer the deployment from the Relay chain ID', () => {
    const stag = validateFundingSetup({ ...INPUT, deploymentId: 'stag' }).setup
    const prod = validateFundingSetup({ ...INPUT, deploymentId: 'prod' }).setup
    assert(stag)
    assert(prod)
    expect(stag.relayChainId).toBe(prod.relayChainId)
    expect(stag.hub).not.toBe(prod.hub)
    expect(isFundingSetupConfirmed(stag, prod)).toBe(false)
  })

  it.each([
    { sourceOwner: '0x2222222222222222222222222222222222222222' as const },
    { recipient: '0x2222222222222222222222222222222222222222' },
    { sourceChainId: 1, walletChainId: 1 },
    { deploymentId: 'prod' },
  ])('requires confirmation again when the pairing changes: %j', change => {
    const confirmed = validateFundingSetup(INPUT).setup
    const current = validateFundingSetup({ ...INPUT, ...change }).setup
    expect(isFundingSetupConfirmed(confirmed, current)).toBe(false)
  })

  it('does not accept disconnected or unconfirmed setups', () => {
    const setup = validateFundingSetup(INPUT).setup
    expect(isFundingSetupConfirmed(setup, setup)).toBe(true)
    expect(isFundingSetupConfirmed(undefined, setup)).toBe(false)
    expect(isFundingSetupConfirmed(setup, undefined)).toBe(false)
  })
})
