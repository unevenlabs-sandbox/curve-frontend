import { isAddress } from 'viem'
import { assert, describe, expect, it } from 'vitest'

describe('public Relay network configuration', () => {
  it('exposes only Depository addresses for the enabled EVM funding networks', () => {
    expect(Object.keys(__RELAY_DEPOSITORIES__).toSorted()).toEqual(['1', '137', '42161', '8453'])
    for (const contracts of Object.values(__RELAY_DEPOSITORIES__)) {
      assert(contracts)
      expect(Object.keys(contracts).toSorted()).toEqual(['dev', 'prod', 'stag'])
      // RPC URLs, overrides, and other package fields must never enter the browser payload.
      for (const address of Object.values(contracts)) {
        expect(typeof address).toBe('string')
        expect(isAddress(address)).toBe(true)
      }
    }
  })
})
