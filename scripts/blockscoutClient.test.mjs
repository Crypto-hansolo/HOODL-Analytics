import { afterEach, describe, expect, it, vi } from 'vitest'
import { blockscoutGet, BLOCKSCOUT_USER_AGENT } from './blockscoutClient.mjs'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('blockscoutGet', () => {
  it('sends a browser-like User-Agent header, without which Blockscout\'s Cloudflare front returns 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await blockscoutGet('https://example.com/api/v2', '/tokens/0xabc/transfers')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/v2/tokens/0xabc/transfers',
      expect.objectContaining({ headers: expect.objectContaining({ 'user-agent': BLOCKSCOUT_USER_AGENT }) }),
    )
  })

  it('throws a descriptive error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }))
    await expect(blockscoutGet('https://example.com/api/v2', '/tokens/0xabc/transfers')).rejects.toThrow(
      'Blockscout HTTP 403 for /tokens/0xabc/transfers',
    )
  })

  it('returns the parsed JSON body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [1, 2, 3] }) }))
    await expect(blockscoutGet('https://example.com/api/v2', '/tokens/0xabc/transfers')).resolves.toEqual({ items: [1, 2, 3] })
  })
})
