import { describe, expect, it } from 'vitest'
import { buildSwapDayBuckets, classifySwap, computeSwapActivity, decodeSwapLog, mergeSwapHistory, SWAP_TOPIC0, trimRecentSwaps } from './poolSwapIndexer.mjs'

const DAY_MS = 24 * 3600_000
const NOW_MS = Date.UTC(2026, 7, 27, 10, 0, 0)
const CUTOFF_MS = Date.UTC(2026, 7, 24, 15, 0, 0)

function swap(partial) {
  return { blockNumber: 1, hash: '0xhash', sender: '0xsender', side: 'buy', hoodlAmount: 1n, timestampMs: NOW_MS, ...partial }
}

function word(hexNoPrefix) {
  return hexNoPrefix.padStart(64, '0')
}

function signedWordHex(value) {
  const asUint = value < 0n ? (1n << 256n) + value : value
  return asUint.toString(16).padStart(64, '0')
}

describe('decodeSwapLog', () => {
  it('decodes a well-formed Swap log into typed fields', () => {
    const sender = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const recipient = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const data = '0x' + signedWordHex(-1000n) + signedWordHex(500n) + word('64') + word('c8') + signedWordHex(42n)
    const log = { topics: [SWAP_TOPIC0, '0x' + word(sender), '0x' + word(recipient)], data }
    const decoded = decodeSwapLog(log)
    expect(decoded).toEqual({
      sender: '0x' + sender,
      recipient: '0x' + recipient,
      amount0: -1000n,
      amount1: 500n,
      sqrtPriceX96: 0x64n,
      liquidity: 0xc8n,
      tick: 42,
    })
  })

  it('throws on a malformed topic count', () => {
    expect(() => decodeSwapLog({ topics: [SWAP_TOPIC0], data: '0x' })).toThrow(/expected 3 topics/)
  })
})

describe('classifySwap', () => {
  it('classifies buy/sell the same way as the frontend implementation', () => {
    expect(classifySwap({ amount0: -100n, amount1: 40n, hoodlIsToken0: true })).toEqual({ side: 'buy', hoodlAmount: 100n })
    expect(classifySwap({ amount0: 30n, amount1: -75n, hoodlIsToken0: false })).toEqual({ side: 'buy', hoodlAmount: 75n })
    expect(classifySwap({ amount0: 50n, amount1: -20n, hoodlIsToken0: true })).toEqual({ side: 'sell', hoodlAmount: 50n })
  })
})

describe('buildSwapDayBuckets / mergeSwapHistory / trimRecentSwaps / computeSwapActivity', () => {
  it('buckets, merges, trims, and aggregates identically to the frontend implementation', () => {
    const swaps = [
      swap({ timestampMs: Date.UTC(2026, 7, 25, 10), sender: '0xA', side: 'buy', hoodlAmount: 100n }),
      swap({ timestampMs: Date.UTC(2026, 7, 25, 14), sender: '0xB', side: 'sell', hoodlAmount: 50n }),
      swap({ timestampMs: Date.UTC(2026, 7, 26, 9), sender: '0xA', side: 'sell', hoodlAmount: 30n }),
    ]
    const buckets = buildSwapDayBuckets({ swaps, nowMs: NOW_MS, cutoffMs: CUTOFF_MS })
    expect(buckets).toEqual([
      { date: '2026-08-25', volumeHoodl: 150n, buyCount: 1, sellCount: 1, uniqueTraders: 2 },
      { date: '2026-08-26', volumeHoodl: 30n, buyCount: 0, sellCount: 1, uniqueTraders: 1 },
    ])

    const merged = mergeSwapHistory({ priorHistory: [buckets[0]], newDays: buckets })
    expect(merged).toEqual(buckets)

    const trimmed = trimRecentSwaps({ swaps: [swap({ hash: '0xold', timestampMs: NOW_MS - 31 * DAY_MS }), swap({ hash: '0xkeep', timestampMs: NOW_MS - DAY_MS })], nowMs: NOW_MS })
    expect(trimmed.map((s) => s.hash)).toEqual(['0xkeep'])

    const activity = computeSwapActivity({ swaps: [swap({ side: 'buy', hoodlAmount: 10n, timestampMs: NOW_MS - 3600_000 })], nowMs: NOW_MS })
    expect(activity).toEqual({ swaps24h: 1, volume24hHoodl: 10n, buyCount24h: 1, sellCount24h: 0, uniqueTraders24h: 1 })
  })
})
