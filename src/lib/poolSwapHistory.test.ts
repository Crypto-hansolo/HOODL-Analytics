import { describe, expect, it } from 'vitest'
import { buildSwapDayBuckets, computeSwapActivity, mergeSwapHistory, trimRecentSwaps } from './poolSwapHistory'
import type { ClassifiedSwap } from './poolSwapHistory'

const H = 3600_000
const DAY = 24 * H
const NOW = Date.UTC(2026, 7, 27, 10)
const swap = (p: Partial<ClassifiedSwap>): ClassifiedSwap => ({ blockNumber: 1, timestampMs: NOW, sender: '0xA', hash: '0x1', side: 'buy', hoodlAmount: 1n, ...p })

describe('swap history', () => {
  it('builds only closed, covered UTC days and preserves zero days', () => {
    const result = buildSwapDayBuckets({ nowMs: NOW, cutoffMs: Date.UTC(2026, 7, 24, 15), swaps: [
      swap({ timestampMs: Date.UTC(2026, 7, 25, 10), hoodlAmount: 100n }),
      swap({ timestampMs: Date.UTC(2026, 7, 25, 14), sender: '0xB', side: 'sell', hoodlAmount: 50n }),
      swap({ timestampMs: Date.UTC(2026, 7, 26, 9), sender: '0xA', side: 'sell', hoodlAmount: 30n }),
    ] })
    expect(result).toEqual([
      { date: '2026-08-25', volumeHoodl: 150n, buyCount: 1, sellCount: 1, uniqueTraders: 2 },
      { date: '2026-08-26', volumeHoodl: 30n, buyCount: 0, sellCount: 1, uniqueTraders: 1 },
    ])
    expect(buildSwapDayBuckets({ nowMs: NOW, cutoffMs: Date.UTC(2026, 7, 25), swaps: [] })).toEqual([
      { date: '2026-08-25', volumeHoodl: 0n, buyCount: 0, sellCount: 0, uniqueTraders: 0 },
      { date: '2026-08-26', volumeHoodl: 0n, buyCount: 0, sellCount: 0, uniqueTraders: 0 },
    ])
  })
  it('merges append-only and trims raw rows at the inclusive boundary', () => {
    const prior = [{ date: '2026-08-25', volumeHoodl: 1n, buyCount: 1, sellCount: 0, uniqueTraders: 1 }]
    expect(mergeSwapHistory({ priorHistory: prior, newDays: [{ ...prior[0], volumeHoodl: 9n }, { date: '2026-08-26', volumeHoodl: 2n, buyCount: 0, sellCount: 1, uniqueTraders: 1 }] })).toEqual([...prior, { date: '2026-08-26', volumeHoodl: 2n, buyCount: 0, sellCount: 1, uniqueTraders: 1 }])
    expect(trimRecentSwaps({ nowMs: NOW, swaps: [swap({ hash: 'old', timestampMs: NOW - 31 * DAY }), swap({ hash: 'boundary', timestampMs: NOW - 30 * DAY })] }).map((s) => s.hash)).toEqual(['boundary'])
  })
  it('computes 24h activity with case-insensitive traders', () => {
    expect(computeSwapActivity({ nowMs: NOW, swaps: [swap({ sender: '0xA', hoodlAmount: 100n, timestampMs: NOW - H }), swap({ sender: '0xa', side: 'sell', hoodlAmount: 40n, timestampMs: NOW - 2 * H }), swap({ timestampMs: NOW - 25 * H })] })).toEqual({ swaps24h: 2, volume24hHoodl: 140n, buyCount24h: 1, sellCount24h: 1, uniqueTraders24h: 1 })
  })
})
