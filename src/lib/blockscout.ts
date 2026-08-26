// Thin client for the Blockscout REST API (v2). This is a secondary,
// optional data source: every function here throws BlockscoutError on any
// network failure, CORS block, non-2xx response, or unexpected payload shape,
// and callers must treat that as "unavailable" rather than retry-forever or
// invent a value.

import { CHAIN, REQUEST_TIMEOUT_MS } from '../config'

export class BlockscoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockscoutError'
  }
}

async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${CHAIN.blockscoutApiBase}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new BlockscoutError(`Blockscout HTTP ${res.status}`)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof BlockscoutError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new BlockscoutError('Blockscout request timed out')
    }
    // fetch() rejects with a generic TypeError for both network errors and
    // CORS blocks — we cannot distinguish them from the browser, so both
    // fall back to the same "unavailable" treatment.
    throw new BlockscoutError(err instanceof Error ? err.message : 'Blockscout request failed')
  } finally {
    clearTimeout(timeout)
  }
}

export interface BlockscoutTokenInfo {
  name: string | null
  symbol: string | null
  decimals: string | null
  totalSupply: string | null
  holdersCount: number | null
  exchangeRateUsd: string | null
}

export async function getTokenInfo(address: string): Promise<BlockscoutTokenInfo> {
  const raw = await getJson<{
    name?: string | null
    symbol?: string | null
    decimals?: string | null
    total_supply?: string | null
    holders?: string | number | null
    holders_count?: string | number | null
    exchange_rate?: string | null
  }>(`/tokens/${address}`)
  const holders = raw.holders_count ?? raw.holders
  return {
    name: raw.name ?? null,
    symbol: raw.symbol ?? null,
    decimals: raw.decimals ?? null,
    totalSupply: raw.total_supply ?? null,
    holdersCount: holders != null ? Number(holders) : null,
    exchangeRateUsd: raw.exchange_rate ?? null,
  }
}

export interface BlockscoutHolder {
  address: string
  value: string
}

export async function getTokenHolders(address: string, limit = 25): Promise<BlockscoutHolder[]> {
  const raw = await getJson<{
    items?: { address?: { hash?: string } | string; value?: string }[]
  }>(`/tokens/${address}/holders`)
  const items = raw.items ?? []
  return items
    .map((item) => {
      const holderAddress = typeof item.address === 'string' ? item.address : item.address?.hash
      return holderAddress && item.value ? { address: holderAddress, value: item.value } : null
    })
    .filter((x): x is BlockscoutHolder => x !== null)
    .slice(0, limit)
}

export interface BlockscoutTransfer {
  hash: string
  from: string
  to: string
  value: string
  timestamp: string | null
  blockNumber: number | null
}

export async function getTokenTransfers(address: string, limit = 20): Promise<BlockscoutTransfer[]> {
  const raw = await getJson<{
    items?: {
      transaction_hash?: string
      tx_hash?: string
      from?: { hash?: string }
      to?: { hash?: string }
      total?: { value?: string }
      timestamp?: string | null
      block_number?: number | null
    }[]
  }>(`/tokens/${address}/transfers`)
  const items = raw.items ?? []
  return items
    .map((item) => {
      const hash = item.transaction_hash ?? item.tx_hash
      const from = item.from?.hash
      const to = item.to?.hash
      const value = item.total?.value
      if (!hash || !from || !to || value === undefined) return null
      return {
        hash,
        from,
        to,
        value,
        timestamp: item.timestamp ?? null,
        blockNumber: item.block_number ?? null,
      }
    })
    .filter((x): x is BlockscoutTransfer => x !== null)
    .slice(0, limit)
}

export interface BlockscoutAddressInfo {
  address: string
  isContract: boolean
  nativeBalanceWei: string | null
  transactionCount: number | null
  isVerified: boolean | null
}

export async function getAddressInfo(address: string): Promise<BlockscoutAddressInfo> {
  const raw = await getJson<{
    hash?: string
    is_contract?: boolean
    coin_balance?: string | null
    transactions_count?: number | string | null
    tx_count?: number | string | null
    is_verified?: boolean | null
  }>(`/addresses/${address}`)
  const txCount = raw.transactions_count ?? raw.tx_count
  return {
    address: raw.hash ?? address,
    isContract: Boolean(raw.is_contract),
    nativeBalanceWei: raw.coin_balance ?? null,
    transactionCount: txCount != null ? Number(txCount) : null,
    isVerified: raw.is_verified ?? null,
  }
}

export interface BlockscoutStats {
  totalBlocks: number | null
  averageBlockTimeSec: number | null
  totalTransactions: number | null
}

export async function getChainStats(): Promise<BlockscoutStats> {
  const raw = await getJson<{
    total_blocks?: string | number | null
    average_block_time?: number | null
    total_transactions?: string | number | null
  }>('/stats')
  return {
    totalBlocks: raw.total_blocks != null ? Number(raw.total_blocks) : null,
    averageBlockTimeSec: raw.average_block_time != null ? raw.average_block_time / 1000 : null,
    totalTransactions: raw.total_transactions != null ? Number(raw.total_transactions) : null,
  }
}
