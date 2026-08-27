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

// Pool identity (address, pair, protocol) is configured/known ground truth.
// Its on-chain mechanics (token0/token1 order, fee tier, tick, liquidity,
// reserves, price, TVL, volume, rewards) are NOT assumed — every such value
// is read live via read-only eth_call against the pool contract's Uniswap V3
// interface and is marked "Unavailable" rather than guessed if the call
// fails (RPC error, revert, timeout, or CORS block).
export const CONFIGURED_POOL = {
  address: '0xF87761231646DA4aa00905c237EaCbfF112Df930',
  pair: 'HOODL/WETH',
  poolType: 'Uniswap V3',
} as const

// Background refresh interval for live data, in milliseconds.
export const REFRESH_INTERVAL_MS = 30_000

// Data older than this is flagged "stale" in the UI while a refresh is
// in flight, instead of silently showing possibly-outdated numbers as fresh.
// This is 3x REFRESH_INTERVAL_MS, for the live 30s poll loop only.
export const STALE_AFTER_MS = 90_000

// The repository snapshot (public/data/snapshot.json) is refreshed by a
// scheduled workflow every 15 minutes, not every 30s like the live poll
// loop — reusing STALE_AFTER_MS against it would flag a snapshot as stale
// seconds after every single refresh. This threshold is 2x the cron
// interval, giving headroom for scheduler jitter/CI delay before a merely
// on-cadence snapshot is mislabeled as stale.
export const SNAPSHOT_STALE_AFTER_MS = 30 * 60_000

// Timeout for any single network request (RPC or REST).
export const REQUEST_TIMEOUT_MS = 10_000
