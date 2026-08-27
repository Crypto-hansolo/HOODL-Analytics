import { describe, expect, it } from 'vitest'
import { mergeIndexedState } from './mergeIndexedState'

const transfer = { hash: '0x1', from: '0xa', to: '0xb', value: '10', timestamp: null, blockNumber: 1 }
const info = { name: 'Hoodl The Fox', symbol: 'HOODL', decimals: '9', totalSupply: '1000', holdersCount: 12, exchangeRateUsd: null, volume24h: null }

describe('mergeIndexedState', () => {
  it('uses live transfers without marking them stale when the snapshot is old', () => {
    const state = mergeIndexedState({ info, liveTransfers: [transfer], holderRows: [], failureCount: 0, now: 2000, snapshotStaleAfterMs: 500, snapshot: { generatedAt: '1970-01-01T00:00:00.000Z', transfers: [transfer] } })
    expect(state.transfers).toEqual([transfer])
    expect(state.snapshotStale).toBe(true)
    expect(state.transfersStale).toBe(false)
  })

  it('flags snapshot fallback rows stale and preserves verified snapshot fields', () => {
    const state = mergeIndexedState({ info: null, liveTransfers: [], holderRows: [], failureCount: 2, now: 2000, snapshotStaleAfterMs: 500, snapshot: { generatedAt: '1970-01-01T00:00:00.000Z', transfers: [transfer], holders: [{ address: '0xc', value: '4' }], holdersComplete: true } })
    expect(state.transfers).toEqual([transfer])
    expect(state.transfersStale).toBe(true)
    expect(state.holders).toBe(1)
    expect(state.error).toBe('2 indexed sources unavailable')
  })
})