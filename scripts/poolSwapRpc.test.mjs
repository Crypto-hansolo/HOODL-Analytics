import { afterEach, describe, expect, it, vi } from 'vitest'
import { ethGetLogsChunked, fetchBlockTimestamps, isRateLimitError, resolvePoolIdentity, rpcCallWithBackoff } from './poolSwapRpc.mjs'

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isRateLimitError', () => {
  it('recognizes a 429 message', () => {
    expect(isRateLimitError(new Error('RPC HTTP 429'))).toBe(true)
    expect(isRateLimitError(new Error('RPC HTTP 500'))).toBe(false)
  })
})

describe('rpcCallWithBackoff', () => {
  it('retries once after a 429 and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, false, 429))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x1' }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await rpcCallWithBackoff('https://rpc.example', 'eth_blockNumber', [], { baseDelayMs: 1 })
    expect(result).toBe('0x1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('ethGetLogsChunked', () => {
  it('splits the requested block range into fixed-size chunks and reports each one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ jsonrpc: '2.0', id: 1, result: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const chunks = []
    await ethGetLogsChunked({
      rpcUrl: 'https://rpc.example',
      address: '0xpool',
      topics: ['0xtopic'],
      fromBlock: 0n,
      toBlock: 25n,
      chunkSpan: 10n,
      onChunk: async (chunk) => chunks.push(chunk),
    })
    expect(chunks.map((c) => [c.fromBlock, c.toBlock])).toEqual([
      [0n, 9n],
      [10n, 19n],
      [20n, 25n],
    ])
  })
})

describe('fetchBlockTimestamps', () => {
  it('batches distinct block numbers into one request and returns a timestamp map', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        { jsonrpc: '2.0', id: 0, result: { timestamp: '0x1' } },
        { jsonrpc: '2.0', id: 1, result: { timestamp: '0x2' } },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const map = await fetchBlockTimestamps('https://rpc.example', [5n, 5n, 6n])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(map.get(5n)).toBe(1000)
    expect(map.get(6n)).toBe(2000)
  })
})

describe('resolvePoolIdentity', () => {
  it('resolves token0/token1/decimals and flags which side is HOODL', async () => {
    const hoodl = '0x9fb3c2d71424122a5886dac627177385d185df09'
    const weth = '0x1111111111111111111111111111111111111111'.slice(0, 42)
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body)
      if (body.params[0].data === '0x0dfe1681') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: '0x' + '0'.repeat(24) + hoodl.slice(2) })
      if (body.params[0].data === '0xd21220a7') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: '0x' + '0'.repeat(24) + weth.slice(2) })
      if (body.params[0].data === '0x313ce567') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: '0x' + (18).toString(16).padStart(64, '0') })
      throw new Error(`unexpected call ${body.params[0].data}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const identity = await resolvePoolIdentity('https://rpc.example', '0xpool', hoodl)
    expect(identity.hoodlIsToken0).toBe(true)
    expect(identity.decimals0).toBe(18)
    expect(identity.decimals1).toBe(18)
    expect(identity.token0.toLowerCase()).toBe(hoodl)
  })
})
