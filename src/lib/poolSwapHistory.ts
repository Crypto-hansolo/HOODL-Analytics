import type { SwapSide } from './poolSwapDirection'

const DAY_MS = 24 * 60 * 60_000
const DEFAULT_WINDOW_DAYS = 30

export interface ClassifiedSwap {
  blockNumber: number
  timestampMs: number
  sender: string
  hash: string
  side: SwapSide
  hoodlAmount: bigint
}

export interface SwapDayBucket {
  date: string
  volumeHoodl: bigint
  buyCount: number
  sellCount: number
  uniqueTraders: number
}

export interface SwapActivity {
  swaps24h: number
  volume24hHoodl: bigint
  buyCount24h: number
  sellCount24h: number
  uniqueTraders24h: number
}

export function dayKeyUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function buildSwapDayBuckets({ swaps, nowMs, cutoffMs }: { swaps: ClassifiedSwap[]; nowMs: number; cutoffMs: number }): SwapDayBucket[] {
  const today = dayKeyUtc(nowMs)
  const first = new Date(cutoffMs)
  first.setUTCHours(0, 0, 0, 0)
  // A cutoff in the middle of a UTC day does not provide full coverage for
  // that day; start at the following midnight. Exact-midnight cutoffs are
  // already aligned and can be included.
  const firstCoveredMs = first.getTime() === cutoffMs ? first.getTime() : first.getTime() + DAY_MS
  const lastClosed = new Date(nowMs)
  lastClosed.setUTCHours(0, 0, 0, 0)
  lastClosed.setTime(lastClosed.getTime() - DAY_MS)
  const buckets = new Map<string, { volumeHoodl: bigint; buyCount: number; sellCount: number; traders: Set<string> }>()
  for (let time = firstCoveredMs; time <= lastClosed.getTime(); time += DAY_MS) {
    buckets.set(dayKeyUtc(time), { volumeHoodl: 0n, buyCount: 0, sellCount: 0, traders: new Set() })
  }
  for (const swap of swaps) {
    const date = dayKeyUtc(swap.timestampMs)
    const bucket = buckets.get(date)
    if (!bucket || date === today) continue
    bucket.volumeHoodl += swap.hoodlAmount
    if (swap.side === 'buy') bucket.buyCount += 1
    else bucket.sellCount += 1
    bucket.traders.add(swap.sender.toLowerCase())
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, volumeHoodl: value.volumeHoodl, buyCount: value.buyCount, sellCount: value.sellCount, uniqueTraders: value.traders.size }))
}

export function mergeSwapHistory({ priorHistory, newDays }: { priorHistory: SwapDayBucket[]; newDays: SwapDayBucket[] }): SwapDayBucket[] {
  const merged = new Map(priorHistory.map((day) => [day.date, day]))
  for (const day of newDays) if (!merged.has(day.date)) merged.set(day.date, day)
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function trimRecentSwaps({ swaps, nowMs, windowDays = DEFAULT_WINDOW_DAYS }: { swaps: ClassifiedSwap[]; nowMs: number; windowDays?: number }): ClassifiedSwap[] {
  const cutoff = nowMs - windowDays * DAY_MS
  return swaps.filter((swap) => swap.timestampMs >= cutoff).sort((a, b) => a.timestampMs - b.timestampMs)
}

export function computeSwapActivity({ swaps, nowMs }: { swaps: ClassifiedSwap[]; nowMs: number }): SwapActivity {
  const recent = swaps.filter((swap) => swap.timestampMs >= nowMs - DAY_MS)
  return {
    swaps24h: recent.length,
    volume24hHoodl: recent.reduce((sum, swap) => sum + swap.hoodlAmount, 0n),
    buyCount24h: recent.filter((swap) => swap.side === 'buy').length,
    sellCount24h: recent.filter((swap) => swap.side === 'sell').length,
    uniqueTraders24h: new Set(recent.map((swap) => swap.sender.toLowerCase())).size,
  }
}
