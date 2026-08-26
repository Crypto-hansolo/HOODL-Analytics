import { useMemo } from 'react'
import { CHAIN, CONFIGURED_POOL, HOODL_TOKEN, REFRESH_INTERVAL_MS } from '../config'
import { erc20BalanceOf, erc20Decimals, erc20Name, erc20Symbol, erc20TotalSupply, topicToAddress, TRANSFER_TOPIC } from './erc20'
import { ethBlockNumber, ethChainId, ethGasPrice, ethGetBalance, ethGetBlockByNumber, ethGetCode, ethGetLogs, ethGetTransactionCount } from './rpc'
import * as blockscout from './blockscout'
import { useFetchState } from './useFetchState'
import type { ChainStatus, HolderRow, TokenInfo, TransferRow } from '../types'

export function useChainStatus() {
  return useFetchState<ChainStatus>(
    async () => {
      const [chainId, blockNumber, gasPriceWei] = await Promise.all([
        ethChainId(),
        ethBlockNumber(),
        ethGasPrice().catch(() => null),
      ])
      return { data: { chainId, blockNumber, gasPriceWei }, source: 'rpc' as const }
    },
    [],
    { intervalMs: REFRESH_INTERVAL_MS },
  )
}

export function useTokenIdentity() {
  return useFetchState<TokenInfo>(
    async () => {
      try {
        const [name, symbol, decimals, totalSupply] = await Promise.all([
          erc20Name(HOODL_TOKEN.address),
          erc20Symbol(HOODL_TOKEN.address),
          erc20Decimals(HOODL_TOKEN.address),
          erc20TotalSupply(HOODL_TOKEN.address),
        ])
        return { data: { name, symbol, decimals, totalSupply }, source: 'rpc' as const }
      } catch (rpcErr) {
        // Explicit fallback to the secondary source before giving up.
        try {
          const info = await blockscout.getTokenInfo(HOODL_TOKEN.address)
          const decimals = info.decimals ? Number(info.decimals) : 18
          return {
            data: {
              name: info.name,
              symbol: info.symbol,
              decimals,
              totalSupply: info.totalSupply ? BigInt(info.totalSupply) : 0n,
            },
            source: 'blockscout' as const,
          }
        } catch {
          throw rpcErr
        }
      }
    },
    [],
    { intervalMs: REFRESH_INTERVAL_MS },
  )
}

export interface TokenMarketMeta {
  holdersCount: number | null
  exchangeRateUsd: string | null
}

export function useTokenMarketMeta() {
  return useFetchState<TokenMarketMeta>(
    async () => {
      const info = await blockscout.getTokenInfo(HOODL_TOKEN.address)
      return { data: { holdersCount: info.holdersCount, exchangeRateUsd: info.exchangeRateUsd }, source: 'blockscout' as const }
    },
    [],
    { intervalMs: REFRESH_INTERVAL_MS },
  )
}

export function useHolders(limit = 25) {
  return useFetchState<HolderRow[]>(
    async () => {
      const holders = await blockscout.getTokenHolders(HOODL_TOKEN.address, limit)
      const rows: HolderRow[] = holders.map((h) => ({ address: h.address, balance: BigInt(h.value), share: null }))
      return { data: rows, source: 'blockscout' as const }
    },
    [limit],
    { intervalMs: REFRESH_INTERVAL_MS },
  )
}

export function useTransfers(limit = 20) {
  return useFetchState<TransferRow[]>(
    async () => {
      try {
        const transfers = await blockscout.getTokenTransfers(HOODL_TOKEN.address, limit)
        const rows: TransferRow[] = transfers.map((t) => ({
          hash: t.hash,
          from: t.from,
          to: t.to,
          value: BigInt(t.value),
          timestamp: t.timestamp ? new Date(t.timestamp).getTime() : null,
          blockNumber: t.blockNumber,
        }))
        return { data: rows, source: 'blockscout' as const }
      } catch (blockscoutErr) {
        // Fall back to raw on-chain logs when the REST API is unavailable.
        try {
          const latest = await ethBlockNumber()
          const fromBlock = latest > 50_000n ? latest - 50_000n : 0n
          const logs = await ethGetLogs({
            address: HOODL_TOKEN.address,
            topics: [TRANSFER_TOPIC],
            fromBlock: '0x' + fromBlock.toString(16),
            toBlock: 'latest',
          })
          const recent = logs.slice(-limit).reverse()
          const rows: TransferRow[] = recent.map((log) => ({
            hash: log.transactionHash,
            from: topicToAddress(log.topics[1] ?? '0x0'),
            to: topicToAddress(log.topics[2] ?? '0x0'),
            value: BigInt(log.data === '0x' ? '0x0' : log.data),
            timestamp: null,
            blockNumber: Number.parseInt(log.blockNumber, 16),
          }))
          return { data: rows, source: 'rpc' as const }
        } catch {
          throw blockscoutErr
        }
      }
    },
    [limit],
    { intervalMs: REFRESH_INTERVAL_MS },
  )
}

export interface PoolFacts {
  address: string
  isContract: boolean
  hoodlBalance: bigint
  nativeBalanceWei: bigint
}

export function usePoolFacts() {
  return useFetchState<PoolFacts>(
    async () => {
      const [code, hoodlBalance, nativeBalanceWei] = await Promise.all([
        ethGetCode(CONFIGURED_POOL.address),
        erc20BalanceOf(HOODL_TOKEN.address, CONFIGURED_POOL.address),
        ethGetBalance(CONFIGURED_POOL.address),
      ])
      return {
        data: { address: CONFIGURED_POOL.address, isContract: code !== '0x', hoodlBalance, nativeBalanceWei },
        source: 'rpc' as const,
      }
    },
    [],
    { intervalMs: REFRESH_INTERVAL_MS },
  )
}

export function usePoolBlockscoutMeta() {
  return useFetchState<blockscout.BlockscoutAddressInfo>(
    async () => {
      const info = await blockscout.getAddressInfo(CONFIGURED_POOL.address)
      return { data: info, source: 'blockscout' as const }
    },
    [],
    { intervalMs: REFRESH_INTERVAL_MS },
  )
}

export function useChainStatsBlockscout() {
  return useFetchState<blockscout.BlockscoutStats>(
    async () => {
      const stats = await blockscout.getChainStats()
      return { data: stats, source: 'blockscout' as const }
    },
    [],
    { intervalMs: REFRESH_INTERVAL_MS },
  )
}

export interface WalletRpcBalances {
  address: string
  hoodlBalance: bigint
  nativeBalanceWei: bigint
  transactionCount: number
}

/** On-demand wallet lookup — only fetches when `address` is a valid, non-empty checksum-agnostic hex address. */
export function useWalletLookup(address: string | null) {
  const enabled = Boolean(address)
  const normalized = useMemo(() => address?.trim() ?? '', [address])

  const rpcState = useFetchState<WalletRpcBalances>(
    async () => {
      const [hoodlBalance, nativeBalanceWei, txCount] = await Promise.all([
        erc20BalanceOf(HOODL_TOKEN.address, normalized),
        ethGetBalance(normalized),
        ethGetTransactionCount(normalized),
      ])
      return {
        data: { address: normalized, hoodlBalance, nativeBalanceWei, transactionCount: txCount },
        source: 'rpc' as const,
      }
    },
    [normalized],
    { enabled },
  )

  const blockscoutState = useFetchState<blockscout.BlockscoutAddressInfo>(
    async () => {
      const info = await blockscout.getAddressInfo(normalized)
      return { data: info, source: 'blockscout' as const }
    },
    [normalized],
    { enabled },
  )

  return { rpcState, blockscoutState }
}

export function useConfiguredChainMatches(chainId: number | null): boolean | null {
  if (chainId === null) return null
  return chainId === CHAIN.id
}

/** Fetches the block timestamp for a raw-log transfer row that lacks one (RPC fallback path). */
export async function fetchBlockTimestamp(blockNumber: number): Promise<number | null> {
  try {
    const block = await ethGetBlockByNumber(BigInt(blockNumber))
    if (!block) return null
    return Number.parseInt(block.timestamp, 16) * 1000
  } catch {
    return null
  }
}
