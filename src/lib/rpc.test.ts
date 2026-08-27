import { afterEach, describe, expect, it, vi } from 'vitest'
import { ethBlockNumber, ethChainId, ethGetCode, RpcError } from './rpc'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rpcCall', () => {
  it('disables HTTP caching so every poll reaches the live RPC endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: '0x1' }))
    vi.stubGlobal('fetch', fetchMock)

    await ethChainId()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  it('decodes a hex block number as a bigint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ result: '0x2a' })))
    await expect(ethBlockNumber()).resolves.toBe(42n)
  })

  it('surfaces a JSON-RPC error payload as an RpcError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'execution reverted' } })))
    await expect(ethGetCode('0xToken')).rejects.toThrow(RpcError)
  })

  it('treats a non-2xx HTTP response as an RpcError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 503)))
    await expect(ethChainId()).rejects.toThrow('RPC HTTP 503')
  })
})
