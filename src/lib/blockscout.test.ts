import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockscoutError, getTokenHolders, getTokenInfo, getTokenTransfers } from './blockscout'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getJson', () => {
  it('disables HTTP caching so every poll reaches the live indexer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await getTokenInfo('0xToken')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  it('treats a non-2xx HTTP response as a BlockscoutError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 404)))
    await expect(getTokenInfo('0xToken')).rejects.toThrow(BlockscoutError)
  })
})

describe('getTokenHolders', () => {
  it('normalizes holder rows and drops entries missing an address or value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            { address: { hash: '0xHolderA' }, value: '100' },
            { address: '0xHolderB', value: '50' },
            { address: { hash: '0xNoValue' } },
          ],
        }),
      ),
    )
    await expect(getTokenHolders('0xToken')).resolves.toEqual([
      { address: '0xHolderA', value: '100' },
      { address: '0xHolderB', value: '50' },
    ])
  })
})

describe('getTokenTransfers', () => {
  it('normalizes transfer rows and drops entries missing required fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              transaction_hash: '0xHash1',
              from: { hash: '0xFrom' },
              to: { hash: '0xTo' },
              total: { value: '10' },
              timestamp: '2026-08-27T00:00:00Z',
              block_number: 5,
            },
            { transaction_hash: '0xHash2', from: { hash: '0xFrom' }, to: { hash: '0xTo' } },
          ],
        }),
      ),
    )
    await expect(getTokenTransfers('0xToken')).resolves.toEqual([
      { hash: '0xHash1', from: '0xFrom', to: '0xTo', value: '10', timestamp: '2026-08-27T00:00:00Z', blockNumber: 5 },
    ])
  })
})
