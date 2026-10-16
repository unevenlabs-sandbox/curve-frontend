/// <reference types="vite/client" />

// Public network metadata from @relay-protocol/settlement-networks, injected at build time.
declare const __RELAY_DEPOSITORIES__: Record<
  number,
  Partial<Record<'dev' | 'stag' | 'prod', import('viem').Address>> | undefined
>
