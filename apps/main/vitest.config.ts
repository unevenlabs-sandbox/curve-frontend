import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { relayDepositories } from './relay-networks.config.mjs'

export default defineConfig({
  define: { __RELAY_DEPOSITORIES__: JSON.stringify(relayDepositories) },
  resolve: { alias: { '@primitives': resolve(import.meta.dirname, '../../packages/primitives/src') } },
  test: { environment: 'node', include: ['src/**/*.spec.{ts,tsx}'] },
})
