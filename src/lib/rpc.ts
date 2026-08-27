// Minimal, dependency-free JSON-RPC client for direct read-only calls against
// the Robinhood Chain RPC endpoint. No wallet, no signing, no writes — every
// call here is a plain `eth_*` read.

import { CHAIN, REQUEST_TIMEOUT_MS } from '../config'

export class RpcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RpcError'
  }
}

let requestId = 0

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(CHAIN.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      signal: controller.signal,
      // Every call here is a live read against a 30s poll loop — a cached
      // response would silently show stale chain state as current.
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new RpcError(`RPC HTTP ${res.status}`)
    }
    const json = (await res.json()) as { result?: T; error?: { message: string } }
    if (json.error) {
      throw new RpcError(json.error.message)
    }
    if (json.result === undefined) {
      throw new RpcError('RPC returned no result')
    }
    return json.result
  } catch (err) {
    if (err instanceof RpcError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new RpcError('RPC request timed out')
    }
    // Network failure or CORS block surfaces as a generic TypeError in fetch.
    throw new RpcError(err instanceof Error ? err.message : 'RPC request failed')
  } finally {
    clearTimeout(timeout)
  }
}

export async function ethChainId(): Promise<number> {
  const hex = await rpcCall<string>('eth_chainId', [])
  return Number.parseInt(hex, 16)
}

export async function ethBlockNumber(): Promise<bigint> {
  const hex = await rpcCall<string>('eth_blockNumber', [])
  return BigInt(hex)
}

export async function ethGasPrice(): Promise<bigint> {
  const hex = await rpcCall<string>('eth_gasPrice', [])
  return BigInt(hex)
}

export async function ethGetBalance(address: string): Promise<bigint> {
  const hex = await rpcCall<string>('eth_getBalance', [address, 'latest'])
  return BigInt(hex)
}

export async function ethGetTransactionCount(address: string): Promise<number> {
  const hex = await rpcCall<string>('eth_getTransactionCount', [address, 'latest'])
  return Number.parseInt(hex, 16)
}

export async function ethGetCode(address: string): Promise<string> {
  return rpcCall<string>('eth_getCode', [address, 'latest'])
}

export async function ethCall(to: string, data: string): Promise<string> {
  return rpcCall<string>('eth_call', [{ to, data }, 'latest'])
}

export interface LogEntry {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
}

export async function ethGetLogs(params: {
  address: string
  topics?: (string | null)[]
  fromBlock?: string
  toBlock?: string
}): Promise<LogEntry[]> {
  return rpcCall<LogEntry[]>('eth_getLogs', [
    {
      address: params.address,
      topics: params.topics ?? [],
      fromBlock: params.fromBlock ?? 'earliest',
      toBlock: params.toBlock ?? 'latest',
    },
  ])
}

export async function ethGetBlockByNumber(blockNumber: bigint): Promise<{ timestamp: string } | null> {
  return rpcCall<{ timestamp: string } | null>('eth_getBlockByNumber', [
    '0x' + blockNumber.toString(16),
    false,
  ])
}
