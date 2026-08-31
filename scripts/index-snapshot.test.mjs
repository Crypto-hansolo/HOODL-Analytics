import { afterEach, describe, expect, it, vi } from 'vitest'
import { indexPoolSwaps } from './index-snapshot.mjs'
import { SWAP_TOPIC0 } from './poolSwapIndexer.mjs'

// The pool/token addresses are hardcoded module-level constants inside
// index-snapshot.mjs (not exported) — mirrored here as literals, same as
// poolSwapIndexer.test.mjs mirrors its own fixtures.
const POOL = '0xF87761231646DA4aa00905c237EaCbfF112Df930'
const HOODL_TOKEN = '0x9fb3c2D71424122a5886DaC627177385d185DF09'
const OTHER_TOKEN = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa'

function hexAddress(address) {
  return '0x' + '0'.repeat(24) + address.replace(/^0x/, '').toLowerCase()
}

function hexUint(value) {
  return '0x' + BigInt(value).toString(16).padStart(64, '0')
}

function signedWord(value) {
  const v = BigInt(value)
  const asUint = v < 0n ? (1n << 256n) + v : v
  return asUint.toString(16).padStart(64, '0')
}

function unsignedWord(value) {
  return BigInt(value).toString(16).padStart(64, '0')
}

function topicAddress(address) {
  return '0x' + address.replace(/^0x/, '').toLowerCase().padStart(64, '0')
}

function swapLog({ blockNumber, sender, recipient = sender, amount0, amount1, sqrtPriceX96 = 1n, liquidity = 1n, tick = 0 }) {
  const data = '0x' + signedWord(amount0) + signedWord(amount1) + unsignedWord(sqrtPriceX96) + unsignedWord(liquidity) + signedWord(tick)
  return {
    address: POOL,
    topics: [SWAP_TOPIC0, topicAddress(sender), topicAddress(recipient)],
    data,
    transactionHash: '0x' + 'ab'.repeat(32),
    blockNumber: '0x' + blockNumber.toString(16),
  }
}

// Mocks the JSON-RPC surface indexPoolSwaps talks to: pool/token identity
// (eth_call), chain tip (eth_blockNumber), Swap logs (eth_getLogs), and
// block timestamps (batched eth_getBlockByNumber).
function makeRpcMock({ token0 = OTHER_TOKEN, token1 = HOODL_TOKEN, decimals0 = 18, decimals1 = 9, latestBlock, logs = [], blockTimestampsMs }) {
  return vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body)
    const requests = Array.isArray(body) ? body : [body]
    const results = requests.map(({ method, params, id }) => {
      let result
      if (method === 'eth_call') {
        const { to, data } = params[0]
        const selector = data.slice(0, 10)
        if (to.toLowerCase() === POOL.toLowerCase()) {
          if (selector === '0x0dfe1681') result = hexAddress(token0)
          else if (selector === '0xd21220a7') result = hexAddress(token1)
          else throw new Error(`unexpected pool selector ${selector}`)
        } else if (to.toLowerCase() === token0.toLowerCase()) {
          result = hexUint(decimals0)
        } else if (to.toLowerCase() === token1.toLowerCase()) {
          result = hexUint(decimals1)
        } else {
          throw new Error(`unexpected eth_call target ${to}`)
        }
      } else if (method === 'eth_blockNumber') {
        result = '0x' + latestBlock.toString(16)
      } else if (method === 'eth_getLogs') {
        const from = BigInt(params[0].fromBlock)
        const to = BigInt(params[0].toBlock)
        result = logs.filter((log) => { const bn = BigInt(log.blockNumber); return bn >= from && bn <= to })
      } else if (method === 'eth_getBlockByNumber') {
        const bn = BigInt(params[0])
        const ts = blockTimestampsMs.get(bn)
        result = ts === undefined ? null : { timestamp: '0x' + Math.floor(ts / 1000).toString(16) }
      } else {
        throw new Error(`unexpected RPC method ${method}`)
      }
      return { jsonrpc: '2.0', id, result }
    })
    const responseBody = Array.isArray(body) ? results : results[0]
    return { ok: true, status: 200, json: async () => responseBody }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('indexPoolSwaps', () => {
  it('backfills from genesis on the first run and computes verified 24h swap activity', async () => {
    const nowMs = Date.UTC(2026, 7, 31, 12, 0, 0)
    const genesisMs = Date.UTC(2026, 0, 1, 0, 0, 0)
    const buyBlockMs = nowMs - 2 * 3600_000
    const sellBlockMs = nowMs - 1 * 3600_000
    const logs = [
      swapLog({ blockNumber: 10n, sender: '0x1111111111111111111111111111111111111a', amount0: 500n, amount1: -1000n }),
      swapLog({ blockNumber: 20n, sender: '0x2222222222222222222222222222222222222b', amount0: -600n, amount1: 300n }),
    ]
    const fetchMock = makeRpcMock({
      latestBlock: 100n,
      logs,
      blockTimestampsMs: new Map([[0n, genesisMs], [10n, buyBlockMs], [20n, sellBlockMs]]),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await indexPoolSwaps(null, new Date(nowMs))

    expect(result.identity.hoodlIsToken0).toBe(false)
    expect(result.indexing).toEqual({ lastIndexedBlock: 100, backfillComplete: true, chunkBlockSpan: 2_000_000, coverageStartMs: genesisMs })
    expect(result.recent).toHaveLength(2)
    // token1 is HOODL here, so a negative amount1 (block 10) is a buy of 1000 HOODL.
    expect(result.activity).toEqual({ swaps24h: 2, volume24hHoodl: '1300', buyCount24h: 1, sellCount24h: 1, uniqueTraders24h: 2 })
  })

  it('returns null when there is no prior state and the very first log chunk fails', async () => {
    const fetchMock = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body)
      const requests = Array.isArray(body) ? body : [body]
      if (requests.some((r) => r.method === 'eth_getLogs')) {
        return { ok: false, status: 500, json: async () => ({}) }
      }
      const results = requests.map(({ method, params, id }) => {
        if (method === 'eth_call') {
          const { to, data } = params[0]
          const selector = data.slice(0, 10)
          if (to.toLowerCase() === POOL.toLowerCase()) {
            return { jsonrpc: '2.0', id, result: selector === '0x0dfe1681' ? hexAddress(OTHER_TOKEN) : hexAddress(HOODL_TOKEN) }
          }
          return { jsonrpc: '2.0', id, result: hexUint(18) }
        }
        if (method === 'eth_blockNumber') return { jsonrpc: '2.0', id, result: '0x64' }
        if (method === 'eth_getBlockByNumber') return { jsonrpc: '2.0', id, result: { timestamp: '0x0' } }
        throw new Error(`unexpected method ${method}`)
      })
      return { ok: true, status: 200, json: async () => (Array.isArray(body) ? results : results[0]) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await indexPoolSwaps(null, new Date())

    expect(result).toBeNull()
  })

  it('reports no new indexing work and returns prior state unchanged when already caught up to the chain tip', async () => {
    const prior = {
      swaps: {
        indexing: { lastIndexedBlock: 100, backfillComplete: true, chunkBlockSpan: 2_000_000, coverageStartMs: 0 },
        recent: [],
        history: [],
        activity: { swaps24h: 0, volume24hHoodl: '0', buyCount24h: 0, sellCount24h: 0, uniqueTraders24h: 0 },
      },
    }
    const fetchMock = makeRpcMock({ latestBlock: 100n, logs: [], blockTimestampsMs: new Map() })
    vi.stubGlobal('fetch', fetchMock)

    const result = await indexPoolSwaps(prior, new Date())

    expect(result.indexing.lastIndexedBlock).toBe(100)
    expect(result.recent).toEqual(prior.swaps.recent)
    expect(result.activity).toEqual(prior.swaps.activity)
    expect(result.identity.hoodlIsToken0).toBe(false)
    // No eth_getLogs call should have been needed since fromBlock (101) > latest (100).
    const methodsCalled = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body)).flat().map((r) => r.method)
    expect(methodsCalled).not.toContain('eth_getLogs')
  })
})
