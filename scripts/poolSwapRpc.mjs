// Minimal, dependency-free JSON-RPC client for the swap-indexing backfill:
// chunked eth_getLogs with rate-limit backoff, batched block-timestamp
// lookups, and read-only pool identity resolution. Mirrors the intent of
// src/lib/rpc.ts and src/lib/uniswapV3.ts but is not imported from them —
// this script runs via plain `node` with no build step.

let requestId = 0

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json.result
}

async function rpcBatch(rpcUrl, requests) {
  const body = requests.map((r, i) => ({ jsonrpc: '2.0', id: i, method: r.method, params: r.params }))
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  const json = await res.json()
  const byId = new Map(json.map((entry) => [entry.id, entry]))
  return requests.map((_, i) => {
    const entry = byId.get(i)
    if (!entry) throw new Error('RPC batch response missing an entry')
    if (entry.error) throw new Error(entry.error.message)
    return entry.result
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRateLimitError(err) {
  return err instanceof Error && /429|Too Many Requests/i.test(err.message)
}

// This backfill runs as a scheduled background job (every 15 minutes via
// GitHub Actions), not on a user-facing request path, so it can afford to
// wait out a rate-limit window rather than give up after a few seconds.
// Observed in practice: the shared Robinhood Chain edge can 429 for well
// over 10 seconds under the request volume a full historical eth_getLogs
// backfill generates, which the previous 5-retry/250ms-base budget (~7.75s
// total) could not outlast.
export async function rpcCallWithBackoff(rpcUrl, method, params, { maxRetries = 8, baseDelayMs = 500 } = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await rpcCall(rpcUrl, method, params)
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err
      attempt += 1
      await sleep(2 ** attempt * baseDelayMs)
    }
  }
}

async function rpcBatchWithBackoff(rpcUrl, requests, { maxRetries = 5, baseDelayMs = 250 } = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await rpcBatch(rpcUrl, requests)
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err
      attempt += 1
      await sleep(2 ** attempt * baseDelayMs)
    }
  }
}

export async function ethBlockNumber(rpcUrl) {
  return BigInt(await rpcCallWithBackoff(rpcUrl, 'eth_blockNumber', []))
}

export async function ethCall(rpcUrl, to, data) {
  return rpcCallWithBackoff(rpcUrl, 'eth_call', [{ to, data }, 'latest'])
}

export async function ethGetLogsChunked({ rpcUrl, address, topics, fromBlock, toBlock, chunkSpan, onChunk }) {
  let start = fromBlock
  let first = true
  while (start <= toBlock) {
    // Space consecutive chunk requests out. The public RPC node rate-limits
    // (observed HTTP 429) on back-to-back eth_getLogs calls with no gap;
    // rpcCallWithBackoff already retries a single 429, but a small pause
    // between chunks keeps the whole backfill under the node's rate budget
    // instead of retrying into it repeatedly.
    if (!first) await sleep(300)
    first = false
    const end = start + chunkSpan - 1n > toBlock ? toBlock : start + chunkSpan - 1n
    const logs = await rpcCallWithBackoff(rpcUrl, 'eth_getLogs', [
      { address, topics, fromBlock: '0x' + start.toString(16), toBlock: '0x' + end.toString(16) },
    ])
    await onChunk({ fromBlock: start, toBlock: end, logs })
    start = end + 1n
  }
}

export async function fetchBlockTimestamps(rpcUrl, blockNumbers) {
  const unique = [...new Set(blockNumbers)]
  const map = new Map()
  if (!unique.length) return map
  const requests = unique.map((n) => ({ method: 'eth_getBlockByNumber', params: ['0x' + n.toString(16), false] }))
  const results = await rpcBatchWithBackoff(rpcUrl, requests)
  unique.forEach((n, i) => {
    const block = results[i]
    if (block?.timestamp) map.set(n, Number.parseInt(block.timestamp, 16) * 1000)
  })
  return map
}

function decodeAddressWord(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  return '0x' + clean.slice(24, 64)
}

function decodeUintWord(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  return BigInt('0x' + clean)
}

const SELECTOR = { token0: '0x0dfe1681', token1: '0xd21220a7', decimals: '0x313ce567' }

export async function resolvePoolIdentity(rpcUrl, poolAddress, hoodlAddress) {
  const [token0Hex, token1Hex] = await Promise.all([ethCall(rpcUrl, poolAddress, SELECTOR.token0), ethCall(rpcUrl, poolAddress, SELECTOR.token1)])
  const token0 = decodeAddressWord(token0Hex)
  const token1 = decodeAddressWord(token1Hex)
  const [decimals0Hex, decimals1Hex] = await Promise.all([ethCall(rpcUrl, token0, SELECTOR.decimals), ethCall(rpcUrl, token1, SELECTOR.decimals)])
  const hoodlIsToken0 = token0.toLowerCase() === hoodlAddress.toLowerCase()
  const hoodlIsToken1 = token1.toLowerCase() === hoodlAddress.toLowerCase()
  if (!hoodlIsToken0 && !hoodlIsToken1) {
    throw new Error('Configured pool does not contain the configured HOODL token as token0 or token1')
  }
  return { token0, token1, decimals0: Number(decodeUintWord(decimals0Hex)), decimals1: Number(decodeUintWord(decimals1Hex)), hoodlIsToken0 }
}
