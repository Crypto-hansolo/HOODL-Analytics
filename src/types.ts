// Where a piece of data actually came from. Every value rendered in the UI
// that isn't hard-coded config must be traceable to one of these.
export type DataSource = 'rpc' | 'blockscout'

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error' | 'unavailable'

// Generic container for any async, potentially-stale, source-attributed value.
export interface FetchState<T> {
  status: FetchStatus
  data: T | null
  source: DataSource | null
  error: string | null
  updatedAt: number | null
  /** true once data is older than STALE_AFTER_MS while a background refresh runs */
  stale: boolean
}

export function initialFetchState<T>(): FetchState<T> {
  return { status: 'idle', data: null, source: null, error: null, updatedAt: null, stale: false }
}

export interface TokenInfo {
  name: string | null
  symbol: string | null
  decimals: number
  totalSupply: bigint
}

export interface ChainStatus {
  chainId: number
  blockNumber: bigint
  gasPriceWei: bigint | null
}

export interface HolderRow {
  address: string
  balance: bigint
  share: number | null
}

export interface TransferRow {
  hash: string
  from: string
  to: string
  value: bigint
  timestamp: number | null
  blockNumber: number | null
}

export interface AddressInfo {
  address: string
  isContract: boolean
  nativeBalanceWei: bigint | null
  transactionCount: number | null
}
