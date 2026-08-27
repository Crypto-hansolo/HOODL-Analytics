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
    expect(state.transfersSource).toBe('live')
  })

  it('flags snapshot fallback rows stale and preserves verified snapshot fields', () => {
    const state = mergeIndexedState({ info: null, liveTransfers: [], holderRows: [], failureCount: 2, now: 2000, snapshotStaleAfterMs: 500, snapshot: { generatedAt: '1970-01-01T00:00:00.000Z', transfers: [transfer], holders: [{ address: '0xc', value: '4' }], holdersComplete: true } })
    expect(state.transfers).toEqual([transfer])
    expect(state.transfersStale).toBe(true)
    expect(state.holders).toBe(1)
    expect(state.error).toBe('2 indexed sources unavailable')
    expect(state.transfersSource).toBe('snapshot')
    expect(state.holdersSource).toBe('snapshot')
  })

  it('reports unavailable sources when neither live nor snapshot data is present', () => {
    const state = mergeIndexedState({ info: null, liveTransfers: [], holderRows: [], failureCount: 1, now: 2000, snapshotStaleAfterMs: 500, snapshot: null })
    expect(state.transfersSource).toBe('unavailable')
    expect(state.holdersSource).toBe('unavailable')
  })

  it('prefers live holder rows over the snapshot fallback', () => {
    const liveHolders = [{ address: '0xd', value: '9' }]
    const state = mergeIndexedState({ info, liveTransfers: [], holderRows: liveHolders, failureCount: 0, now: 2000, snapshotStaleAfterMs: 500, snapshot: { generatedAt: '1970-01-01T00:00:00.000Z', transfers: [], holders: [{ address: '0xc', value: '4' }], holdersComplete: true } })
    expect(state.holderRows).toEqual(liveHolders)
    expect(state.holdersSource).toBe('live')
  })
})

describe('mergeIndexedState — swap activity', () => {
  it('surfaces verified swap activity from the snapshot', () => {
    const swapActivity = { swaps24h: 5, volume24hHoodl: '1000', buyCount24h: 3, sellCount24h: 2, uniqueTraders24h: 4 }
    const state = mergeIndexedState({
      info: null,
      liveTransfers: [],
      holderRows: [],
      failureCount: 0,
      now: 2000,
      snapshotStaleAfterMs: 500,
      snapshot: { generatedAt: '1970-01-01T00:00:00.000Z', transfers: [], swaps: { activity: swapActivity, indexing: { lastIndexedBlock: 10, backfillComplete: true, coverageStartMs: 0 } } },
    })
    expect(state.swapActivity).toEqual(swapActivity)
    expect(state.swapsSource).toBe('snapshot')
    expect(state.swapIndexing).toEqual({ lastIndexedBlock: 10, backfillComplete: true, coverageStartMs: 0 })
  })

  it('degrades to unavailable when the snapshot has no swaps section (old schema)', () => {
    const state = mergeIndexedState({ info: null, liveTransfers: [], holderRows: [], failureCount: 0, now: 2000, snapshotStaleAfterMs: 500, snapshot: { generatedAt: '1970-01-01T00:00:00.000Z', transfers: [] } })
    expect(state.swapActivity).toBeNull()
    expect(state.swapsSource).toBe('unavailable')
    expect(state.swapIndexing).toBeNull()
  })
})