import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@primitives': resolve(import.meta.dirname, '../../packages/primitives/src') } },
  test: { environment: 'node', include: ['src/**/*.spec.{ts,tsx}'] },
})
