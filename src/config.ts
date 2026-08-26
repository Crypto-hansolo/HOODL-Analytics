// Centralized, hand-verified configuration for the HOODL Token Analytics dashboard.
// Every address/URL here is the single source of truth — nothing else in the app
// should hard-code a chain id, RPC URL, explorer URL, or contract address.

export const CHAIN = {
  id: 4663,
  name: 'Robinhood Chain',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  // Blockscout REST API base (v2). Used opportunistically; every call falls
  // back to an explicit "unavailable" state on error, timeout, or CORS block.
  blockscoutApiBase: 'https://robinhoodchain.blockscout.com/api/v2',
} as const

export const HOODL_TOKEN = {
  address: '0x9fb3c2D71424122a5886DaC627177385d185DF09',
  symbol: 'HOODL',
} as const

// A pool address was supplied for this dashboard, but its DEX protocol, pair
// composition, ABI, fee tier, and rewards mechanics have NOT been verified.
// We only ever display facts we can read directly (token/native balances of
// this address) and we label everything else as unverified. We never guess
// at or fabricate AMM reserves, prices, fees, or reward mechanics for it.
export const CONFIGURED_POOL = {
  address: '0xF87761231646DA4aa00905c237EaCbfF112Df930',
  verified: false,
} as const

// Background refresh interval for live data, in milliseconds.
export const REFRESH_INTERVAL_MS = 30_000

// Data older than this is flagged "stale" in the UI while a refresh is
// in flight, instead of silently showing possibly-outdated numbers as fresh.
export const STALE_AFTER_MS = 90_000

// Timeout for any single network request (RPC or REST).
export const REQUEST_TIMEOUT_MS = 10_000
