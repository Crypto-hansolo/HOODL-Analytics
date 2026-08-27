# Uniswap V3 Swap Event Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, verified index of the configured HOODL/WETH Uniswap V3 pool's Swap events, exposing real 24h volume, buy/sell counts, and unique-trader counts — replacing the current live-only, ~1.4-hour-window swap view with a full-history, incrementally-updated snapshot.

**Architecture:** Extends the existing 15-minute GitHub Actions snapshot cron (`scripts/index-snapshot.mjs` → `public/data/snapshot.json`, committed to the repo, served as a static file). A new pure, unit-tested classification/aggregation core is written twice — once in TypeScript under `src/lib/` (used by the frontend build and its own tests) and once in plain JavaScript under `scripts/` (used by the Node snapshot script, which runs without a build step) — verified against equivalent test cases to keep behavior in parity without cross-runtime imports. A new script-side RPC layer does chunked `eth_getLogs` backfill with rate-limit backoff and batched block-timestamp lookups. The frontend's `mergeIndexedState` and Trading tab are extended to surface the new snapshot fields.

**Tech Stack:** TypeScript + React (frontend, Vite, Vitest), plain Node ESM (snapshot script, no external dependencies, `fetch` only), GitHub Actions (existing cron).

**Spec:** `docs/superpowers/specs/2026-08-27-uniswap-v3-swap-indexing-design.md`

## Global Constraints

- Robinhood Chain block time ≈ 0.101s/block (verified live); chain is only ~55 days old at spec time.
- `eth_getLogs` chunk span for backfill: **2,000,000 blocks** per request (verified fast and reliable; full 0→latest times out).
- The RPC endpoint rate-limits aggressive request bursts with JSON-RPC/HTTP `429` — all script-side RPC calls must retry with exponential backoff.
- Raw swap rows (`recent`) are kept only for a rolling **30-day** window; day-bucket aggregates (`history`) are kept **forever**, append-only, never overwritten (mirrors the existing transfer-history pattern in `scripts/index-snapshot.mjs`).
- "Trader" = unique Swap-event `sender` address — an approximation, documented as such in code comments and UI copy, never labeled "unique wallet".
- `snapshot.json` `schemaVersion` bumps from `3` to `4` by adding a new top-level `swaps` object; absence of `swaps` (old cached snapshot) must degrade to "Unavailable", never crash.
- Swap indexing is an independent failure domain: any failure must leave the existing `swaps` section untouched and must never abort transfer/holder indexing or the overall script run.
- No USD pricing, no fees/rewards, no TVL, no trader leaderboard in this plan — out of scope, tracked separately.
- `npm test`, `npm run lint`, and `npm run build` must all pass before this work is done.

---

## Task 1: Buy/sell classification (frontend pure logic)

**Files:**
- Create: `src/lib/poolSwapDirection.ts`
- Test: `src/lib/poolSwapDirection.test.ts`

**Interfaces:**
- Produces: `export type SwapSide = 'buy' | 'sell'`; `export interface SwapDirectionInput { amount0: bigint; amount1: bigint; hoodlIsToken0: boolean }`; `export interface SwapDirectionResult { side: SwapSide; hoodlAmount: bigint }`; `export function classifySwapDirection(input: SwapDirectionInput): SwapDirectionResult`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/poolSwapDirection.test.ts
import { describe, expect, it } from 'vitest'
import { classifySwapDirection } from './poolSwapDirection'

describe('classifySwapDirection', () => {
  it('classifies a buy when HOODL is token0 and amount0 is negative (pool sent HOODL out)', () => {
    const result = classifySwapDirection({ amount0: -100n, amount1: 40n, hoodlIsToken0: true })
    expect(result).toEqual({ side: 'buy', hoodlAmount: 100n })
  })

  it('classifies a sell when HOODL is token0 and amount0 is positive (trader sent HOODL in)', () => {
    const result = classifySwapDirection({ amount0: 50n, amount1: -20n, hoodlIsToken0: true })
    expect(result).toEqual({ side: 'sell', hoodlAmount: 50n })
  })

  it('classifies a buy when HOODL is token1 and amount1 is negative', () => {
    const result = classifySwapDirection({ amount0: 30n, amount1: -75n, hoodlIsToken0: false })
    expect(result).toEqual({ side: 'buy', hoodlAmount: 75n })
  })

  it('classifies a sell when HOODL is token1 and amount1 is positive', () => {
    const result = classifySwapDirection({ amount0: -10n, amount1: 30n, hoodlIsToken0: false })
    expect(result).toEqual({ side: 'sell', hoodlAmount: 30n })
  })

  it('treats a zero HOODL-side amount as a sell of zero (documented degenerate case, never thrown)', () => {
    const result = classifySwapDirection({ amount0: 0n, amount1: 15n, hoodlIsToken0: true })
    expect(result).toEqual({ side: 'sell', hoodlAmount: 0n })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/poolSwapDirection.test.ts`
Expected: FAIL — `Cannot find module './poolSwapDirection'` or similar.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/poolSwapDirection.ts
// Classifies a decoded Uniswap V3 Swap event as a buy or sell of HOODL,
// from the pool's own signed amount0/amount1 deltas. A negative HOODL-side
// amount means the pool sent HOODL to the trader (buy); a positive amount
// means the trader sent HOODL into the pool (sell). Which side is HOODL
// must come from a verified on-chain token0()/token1() read — never assumed.

export type SwapSide = 'buy' | 'sell'

export interface SwapDirectionInput {
  amount0: bigint
  amount1: bigint
  hoodlIsToken0: boolean
}

export interface SwapDirectionResult {
  side: SwapSide
  hoodlAmount: bigint
}

export function classifySwapDirection({ amount0, amount1, hoodlIsToken0 }: SwapDirectionInput): SwapDirectionResult {
  const hoodlSigned = hoodlIsToken0 ? amount0 : amount1
  const side: SwapSide = hoodlSigned < 0n ? 'buy' : 'sell'
  const hoodlAmount = hoodlSigned < 0n ? -hoodlSigned : hoodlSigned
  return { side, hoodlAmount }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/poolSwapDirection.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/poolSwapDirection.ts src/lib/poolSwapDirection.test.ts
git commit -m "feat: add Uniswap V3 swap buy/sell classification"
```

---

## Task 2: Day-bucket aggregation, history merge, rolling trim (frontend pure logic)

**Files:**
- Create: `src/lib/poolSwapHistory.ts`
- Test: `src/lib/poolSwapHistory.test.ts`

**Interfaces:**
- Consumes: `SwapSide` from `./poolSwapDirection` (Task 1).
- Produces: `export interface ClassifiedSwap { blockNumber: number; timestampMs: number; sender: string; hash: string; side: SwapSide; hoodlAmount: bigint }`; `export interface SwapDayBucket { date: string; volumeHoodl: bigint; buyCount: number; sellCount: number; uniqueTraders: number }`; `export interface SwapActivity { swaps24h: number; volume24hHoodl: bigint; buyCount24h: number; sellCount24h: number; uniqueTraders24h: number }`; `export function dayKeyUtc(ms: number): string`; `export function buildSwapDayBuckets(params: { swaps: ClassifiedSwap[]; nowMs: number; cutoffMs: number }): SwapDayBucket[]`; `export function mergeSwapHistory(params: { priorHistory: SwapDayBucket[]; newDays: SwapDayBucket[] }): SwapDayBucket[]`; `export function trimRecentSwaps(params: { swaps: ClassifiedSwap[]; nowMs: number; windowDays?: number }): ClassifiedSwap[]`; `export function computeSwapActivity(params: { swaps: ClassifiedSwap[]; nowMs: number }): SwapActivity`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/poolSwapHistory.test.ts
import { describe, expect, it } from 'vitest'
import { buildSwapDayBuckets, computeSwapActivity, mergeSwapHistory, trimRecentSwaps } from './poolSwapHistory'
import type { ClassifiedSwap, SwapDayBucket } from './poolSwapHistory'

const DAY_MS = 24 * 3600_000
const NOW_MS = Date.UTC(2026, 7, 27, 10, 0, 0) // 2026-08-27T10:00:00Z ("today", in progress)
const CUTOFF_MS = Date.UTC(2026, 7, 24, 15, 0, 0) // 2026-08-24T15:00:00Z -> first fully covered day is 2026-08-25

function swap(partial: Partial<ClassifiedSwap>): ClassifiedSwap {
  return { blockNumber: 1, hash: '0xhash', sender: '0xsender', side: 'buy', hoodlAmount: 1n, timestampMs: NOW_MS, ...partial }
}

describe('buildSwapDayBuckets', () => {
  it('buckets swaps into verified closed UTC days and excludes today and days before coverage', () => {
    const swaps: ClassifiedSwap[] = [
      swap({ timestampMs: Date.UTC(2026, 7, 25, 10), sender: '0xA', side: 'buy', hoodlAmount: 100n }),
      swap({ timestampMs: Date.UTC(2026, 7, 25, 14), sender: '0xB', side: 'sell', hoodlAmount: 50n }),
      swap({ timestampMs: Date.UTC(2026, 7, 26, 9), sender: '0xA', side: 'sell', hoodlAmount: 30n }),
      swap({ timestampMs: Date.UTC(2026, 7, 24, 8), sender: '0xC', side: 'buy', hoodlAmount: 999n }), // before coverage
      swap({ timestampMs: Date.UTC(2026, 7, 27, 9), sender: '0xD', side: 'buy', hoodlAmount: 999n }), // today, in progress
    ]
    const buckets = buildSwapDayBuckets({ swaps, nowMs: NOW_MS, cutoffMs: CUTOFF_MS })
    expect(buckets).toEqual([
      { date: '2026-08-25', volumeHoodl: 150n, buyCount: 1, sellCount: 1, uniqueTraders: 2 },
      { date: '2026-08-26', volumeHoodl: 30n, buyCount: 0, sellCount: 1, uniqueTraders: 1 },
    ])
  })

  it('produces a verified zero-volume day when a covered day truly has no swaps', () => {
    const buckets = buildSwapDayBuckets({ swaps: [], nowMs: NOW_MS, cutoffMs: CUTOFF_MS })
    expect(buckets).toEqual([
      { date: '2026-08-25', volumeHoodl: 0n, buyCount: 0, sellCount: 0, uniqueTraders: 0 },
      { date: '2026-08-26', volumeHoodl: 0n, buyCount: 0, sellCount: 0, uniqueTraders: 0 },
    ])
  })
})

describe('mergeSwapHistory', () => {
  it('never overwrites a previously recorded closed day and appends only new ones', () => {
    const prior: SwapDayBucket[] = [{ date: '2026-08-25', volumeHoodl: 150n, buyCount: 1, sellCount: 1, uniqueTraders: 2 }]
    const newDays: SwapDayBucket[] = [
      { date: '2026-08-25', volumeHoodl: 0n, buyCount: 0, sellCount: 0, uniqueTraders: 0 }, // stale recompute, must be ignored
      { date: '2026-08-26', volumeHoodl: 30n, buyCount: 0, sellCount: 1, uniqueTraders: 1 },
    ]
    const merged = mergeSwapHistory({ priorHistory: prior, newDays })
    expect(merged).toEqual([
      { date: '2026-08-25', volumeHoodl: 150n, buyCount: 1, sellCount: 1, uniqueTraders: 2 },
      { date: '2026-08-26', volumeHoodl: 30n, buyCount: 0, sellCount: 1, uniqueTraders: 1 },
    ])
  })
})

describe('trimRecentSwaps', () => {
  it('drops rows older than the rolling window and keeps rows within it, including the boundary', () => {
    const swaps: ClassifiedSwap[] = [
      swap({ hash: '0xold', timestampMs: NOW_MS - 31 * DAY_MS }),
      swap({ hash: '0xboundary', timestampMs: NOW_MS - 30 * DAY_MS }),
      swap({ hash: '0xrecent', timestampMs: NOW_MS - 1 * DAY_MS }),
    ]
    const kept = trimRecentSwaps({ swaps, nowMs: NOW_MS })
    expect(kept.map((s) => s.hash)).toEqual(['0xboundary', '0xrecent'])
  })
})

describe('computeSwapActivity', () => {
  it('computes 24h volume, buy/sell counts, and unique traders from the rolling window', () => {
    const swaps: ClassifiedSwap[] = [
      swap({ hash: '0x1', sender: '0xA', side: 'buy', hoodlAmount: 100n, timestampMs: NOW_MS - 1 * 3600_000 }),
      swap({ hash: '0x2', sender: '0xB', side: 'sell', hoodlAmount: 40n, timestampMs: NOW_MS - 2 * 3600_000 }),
      swap({ hash: '0x3', sender: '0xA', side: 'buy', hoodlAmount: 10n, timestampMs: NOW_MS - 25 * 3600_000 }), // older than 24h
    ]
    const activity = computeSwapActivity({ swaps, nowMs: NOW_MS })
    expect(activity).toEqual({ swaps24h: 2, volume24hHoodl: 140n, buyCount24h: 1, sellCount24h: 1, uniqueTraders24h: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/poolSwapHistory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/poolSwapHistory.ts
// Pure day-bucket aggregation and rolling-window logic for indexed pool
// swaps. Mirrors the verified-coverage rules already used for transfer
// history in scripts/index-snapshot.mjs: a UTC day is only ever recorded
// once it is fully closed and fully within verified coverage, and a day
// with genuinely zero swaps is recorded as a real zero, not a gap. History
// is permanent and append-only; only the raw "recent" swap rows roll off.

import type { SwapSide } from './poolSwapDirection'

const DAY_MS = 24 * 3600_000
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

function dayStartUtc(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export function buildSwapDayBuckets({ swaps, nowMs, cutoffMs }: { swaps: ClassifiedSwap[]; nowMs: number; cutoffMs: number }): SwapDayBucket[] {
  const todayStart = dayStartUtc(nowMs)
  const firstCoveredDayStart = Math.ceil(cutoffMs / DAY_MS) * DAY_MS
  const buckets = new Map<string, { volume: bigint; buy: number; sell: number; traders: Set<string> }>()
  for (let dayStart = firstCoveredDayStart; dayStart < todayStart; dayStart += DAY_MS) {
    buckets.set(dayKeyUtc(dayStart), { volume: 0n, buy: 0, sell: 0, traders: new Set() })
  }
  for (const s of swaps) {
    const dayStart = dayStartUtc(s.timestampMs)
    if (dayStart < firstCoveredDayStart || dayStart >= todayStart) continue
    const bucket = buckets.get(dayKeyUtc(dayStart))
    if (!bucket) continue
    bucket.volume += s.hoodlAmount
    if (s.side === 'buy') bucket.buy += 1
    else bucket.sell += 1
    bucket.traders.add(s.sender.toLowerCase())
  }
  return [...buckets.entries()]
    .map(([date, b]) => ({ date, volumeHoodl: b.volume, buyCount: b.buy, sellCount: b.sell, uniqueTraders: b.traders.size }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function mergeSwapHistory({ priorHistory, newDays }: { priorHistory: SwapDayBucket[]; newDays: SwapDayBucket[] }): SwapDayBucket[] {
  const merged = new Map(priorHistory.map((day) => [day.date, day]))
  for (const day of newDays) {
    if (!merged.has(day.date)) merged.set(day.date, day)
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function trimRecentSwaps({ swaps, nowMs, windowDays = DEFAULT_WINDOW_DAYS }: { swaps: ClassifiedSwap[]; nowMs: number; windowDays?: number }): ClassifiedSwap[] {
  const cutoff = nowMs - windowDays * DAY_MS
  return swaps.filter((s) => s.timestampMs >= cutoff)
}

export function computeSwapActivity({ swaps, nowMs }: { swaps: ClassifiedSwap[]; nowMs: number }): SwapActivity {
  const cutoff = nowMs - DAY_MS
  const within = swaps.filter((s) => s.timestampMs >= cutoff)
  const volume24hHoodl = within.reduce((sum, s) => sum + s.hoodlAmount, 0n)
  const buyCount24h = within.filter((s) => s.side === 'buy').length
  return {
    swaps24h: within.length,
    volume24hHoodl,
    buyCount24h,
    sellCount24h: within.length - buyCount24h,
    uniqueTraders24h: new Set(within.map((s) => s.sender.toLowerCase())).size,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/poolSwapHistory.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/poolSwapHistory.ts src/lib/poolSwapHistory.test.ts
git commit -m "feat: add swap day-bucket aggregation and rolling-window logic"
```

---

## Task 3: Script-side decode/classify/aggregate reimplementation (plain JS)

**Files:**
- Create: `scripts/poolSwapIndexer.mjs`
- Test: `scripts/poolSwapIndexer.test.mjs`

**Interfaces:**
- Produces: `export const SWAP_TOPIC0`; `export function decodeSwapLog(log: { topics: string[]; data: string }): { sender, recipient, amount0: bigint, amount1: bigint, sqrtPriceX96: bigint, liquidity: bigint, tick: number }`; `export function classifySwap({ amount0, amount1, hoodlIsToken0 })`; `export function dayKeyUtc(ms)`; `export function buildSwapDayBuckets({ swaps, nowMs, cutoffMs })`; `export function mergeSwapHistory({ priorHistory, newDays })`; `export function trimRecentSwaps({ swaps, nowMs, windowDays })`; `export function computeSwapActivity({ swaps, nowMs })`.
- Note: this module intentionally reimplements Task 1 and Task 2's logic in plain JS (no shared import — the Node snapshot script runs without a build/type-stripping step). Test cases below mirror the TypeScript test fixtures in `src/lib/poolSwapDirection.test.ts` and `src/lib/poolSwapHistory.test.ts` to keep both implementations verified in parity.

- [ ] **Step 1: Write the failing test**

```js
// scripts/poolSwapIndexer.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/poolSwapIndexer.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/poolSwapIndexer.mjs
// Plain-JS reimplementation of the pool-swap decode/classification/
// aggregation logic used by the TypeScript frontend (src/lib/
// poolSwapDirection.ts, src/lib/poolSwapHistory.ts). Duplicated rather
// than imported because this script runs directly via `node` with no
// build step and cannot import TypeScript sources. Test cases in
// poolSwapIndexer.test.mjs mirror the frontend's test fixtures to keep
// both implementations verified in parity.

export const SWAP_TOPIC0 = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'

const DAY_MS = 24 * 3600_000
const DEFAULT_WINDOW_DAYS = 30
const WORD_HEX_LEN = 64

function stripHexPrefix(hex) {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
}

function decodeAddressTopic(topic) {
  return '0x' + stripHexPrefix(topic).slice(-40)
}

function decodeSignedWord(word) {
  const value = BigInt('0x' + word)
  const signBit = 1n << 255n
  return value >= signBit ? value - (1n << 256n) : value
}

export function decodeSwapLog(log) {
  if (log.topics.length !== 3) {
    throw new Error(`Malformed Swap log: expected 3 topics, got ${log.topics.length}`)
  }
  const [topic0, senderTopic, recipientTopic] = log.topics
  if (stripHexPrefix(topic0).toLowerCase() !== stripHexPrefix(SWAP_TOPIC0).toLowerCase()) {
    throw new Error('Malformed Swap log: topic0 does not match the canonical Swap event signature')
  }
  const data = stripHexPrefix(log.data)
  if (data.length !== WORD_HEX_LEN * 5) {
    throw new Error(`Malformed Swap log data: expected 5 ABI words, got ${data.length / WORD_HEX_LEN}`)
  }
  const words = Array.from({ length: 5 }, (_, i) => data.slice(i * WORD_HEX_LEN, i * WORD_HEX_LEN + WORD_HEX_LEN))
  return {
    sender: decodeAddressTopic(senderTopic),
    recipient: decodeAddressTopic(recipientTopic),
    amount0: decodeSignedWord(words[0]),
    amount1: decodeSignedWord(words[1]),
    sqrtPriceX96: BigInt('0x' + words[2]),
    liquidity: BigInt('0x' + words[3]),
    tick: Number(decodeSignedWord(words[4])),
  }
}

export function classifySwap({ amount0, amount1, hoodlIsToken0 }) {
  const hoodlSigned = hoodlIsToken0 ? amount0 : amount1
  const side = hoodlSigned < 0n ? 'buy' : 'sell'
  const hoodlAmount = hoodlSigned < 0n ? -hoodlSigned : hoodlSigned
  return { side, hoodlAmount }
}

export function dayKeyUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

function dayStartUtc(ms) {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export function buildSwapDayBuckets({ swaps, nowMs, cutoffMs }) {
  const todayStart = dayStartUtc(nowMs)
  const firstCoveredDayStart = Math.ceil(cutoffMs / DAY_MS) * DAY_MS
  const buckets = new Map()
  for (let dayStart = firstCoveredDayStart; dayStart < todayStart; dayStart += DAY_MS) {
    buckets.set(dayKeyUtc(dayStart), { volume: 0n, buy: 0, sell: 0, traders: new Set() })
  }
  for (const s of swaps) {
    const dayStart = dayStartUtc(s.timestampMs)
    if (dayStart < firstCoveredDayStart || dayStart >= todayStart) continue
    const bucket = buckets.get(dayKeyUtc(dayStart))
    if (!bucket) continue
    bucket.volume += s.hoodlAmount
    if (s.side === 'buy') bucket.buy += 1
    else bucket.sell += 1
    bucket.traders.add(s.sender.toLowerCase())
  }
  return [...buckets.entries()]
    .map(([date, b]) => ({ date, volumeHoodl: b.volume, buyCount: b.buy, sellCount: b.sell, uniqueTraders: b.traders.size }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function mergeSwapHistory({ priorHistory, newDays }) {
  const merged = new Map(priorHistory.map((day) => [day.date, day]))
  for (const day of newDays) {
    if (!merged.has(day.date)) merged.set(day.date, day)
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function trimRecentSwaps({ swaps, nowMs, windowDays = DEFAULT_WINDOW_DAYS }) {
  const cutoff = nowMs - windowDays * DAY_MS
  return swaps.filter((s) => s.timestampMs >= cutoff)
}

export function computeSwapActivity({ swaps, nowMs }) {
  const cutoff = nowMs - DAY_MS
  const within = swaps.filter((s) => s.timestampMs >= cutoff)
  const volume24hHoodl = within.reduce((sum, s) => sum + s.hoodlAmount, 0n)
  const buyCount24h = within.filter((s) => s.side === 'buy').length
  return {
    swaps24h: within.length,
    volume24hHoodl,
    buyCount24h,
    sellCount24h: within.length - buyCount24h,
    uniqueTraders24h: new Set(within.map((s) => s.sender.toLowerCase())).size,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/poolSwapIndexer.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/poolSwapIndexer.mjs scripts/poolSwapIndexer.test.mjs
git commit -m "feat: add script-side swap decode/classify/aggregate module"
```

---

## Task 4: Script-side RPC layer (chunked backfill, backoff, batched timestamps)

**Files:**
- Create: `scripts/poolSwapRpc.mjs`
- Test: `scripts/poolSwapRpc.test.mjs`

**Interfaces:**
- Produces: `export async function ethBlockNumber(rpcUrl)`; `export async function ethCall(rpcUrl, to, data)`; `export async function ethGetLogsChunked({ rpcUrl, address, topics, fromBlock, toBlock, chunkSpan, onChunk })` (all block params are `bigint`); `export async function fetchBlockTimestamps(rpcUrl, blockNumbers)` returns `Map<bigint, number>`; `export async function resolvePoolIdentity(rpcUrl, poolAddress, hoodlAddress)` returns `{ token0, token1, decimals0, decimals1, hoodlIsToken0 }`; `export function isRateLimitError(err)`; `export async function rpcCallWithBackoff(rpcUrl, method, params, options)`.
- Consumes: nothing from other tasks (standalone RPC client, mirrors the intent of `src/lib/rpc.ts` and `src/lib/uniswapV3.ts` but is not imported from them).

- [ ] **Step 1: Write the failing test**

```js
// scripts/poolSwapRpc.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/poolSwapRpc.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/poolSwapRpc.mjs
// Minimal, dependency-free JSON-RPC client for the swap-indexing backfill:
// chunked eth_getLogs with rate-limit backoff, batched block-timestamp
// lookups, and read-only pool identity resolution. Mirrors the intent of
// src/lib/rpc.ts and src/lib/uniswapV3.ts but is not imported from them —
// this script runs via plain `node` with no build step.

let requestId = 0

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json.result
}

async function rpcBatch(rpcUrl, requests) {
  const body = requests.map((r, i) => ({ jsonrpc: '2.0', id: i, method: r.method, params: r.params }))
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  const json = await res.json()
  const byId = new Map(json.map((entry) => [entry.id, entry]))
  return requests.map((_, i) => {
    const entry = byId.get(i)
    if (!entry) throw new Error('RPC batch response missing an entry')
    if (entry.error) throw new Error(entry.error.message)
    return entry.result
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRateLimitError(err) {
  return err instanceof Error && /429|Too Many Requests/i.test(err.message)
}

export async function rpcCallWithBackoff(rpcUrl, method, params, { maxRetries = 5, baseDelayMs = 250 } = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await rpcCall(rpcUrl, method, params)
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err
      attempt += 1
      await sleep(2 ** attempt * baseDelayMs)
    }
  }
}

async function rpcBatchWithBackoff(rpcUrl, requests, { maxRetries = 5, baseDelayMs = 250 } = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await rpcBatch(rpcUrl, requests)
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err
      attempt += 1
      await sleep(2 ** attempt * baseDelayMs)
    }
  }
}

export async function ethBlockNumber(rpcUrl) {
  return BigInt(await rpcCallWithBackoff(rpcUrl, 'eth_blockNumber', []))
}

export async function ethCall(rpcUrl, to, data) {
  return rpcCallWithBackoff(rpcUrl, 'eth_call', [{ to, data }, 'latest'])
}

export async function ethGetLogsChunked({ rpcUrl, address, topics, fromBlock, toBlock, chunkSpan, onChunk }) {
  let start = fromBlock
  while (start <= toBlock) {
    const end = start + chunkSpan - 1n > toBlock ? toBlock : start + chunkSpan - 1n
    const logs = await rpcCallWithBackoff(rpcUrl, 'eth_getLogs', [
      { address, topics, fromBlock: '0x' + start.toString(16), toBlock: '0x' + end.toString(16) },
    ])
    await onChunk({ fromBlock: start, toBlock: end, logs })
    start = end + 1n
  }
}

export async function fetchBlockTimestamps(rpcUrl, blockNumbers) {
  const unique = [...new Set(blockNumbers)]
  const map = new Map()
  if (!unique.length) return map
  const requests = unique.map((n) => ({ method: 'eth_getBlockByNumber', params: ['0x' + n.toString(16), false] }))
  const results = await rpcBatchWithBackoff(rpcUrl, requests)
  unique.forEach((n, i) => {
    const block = results[i]
    if (block?.timestamp) map.set(n, Number.parseInt(block.timestamp, 16) * 1000)
  })
  return map
}

function decodeAddressWord(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  return '0x' + clean.slice(24, 64)
}

function decodeUintWord(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  return BigInt('0x' + clean)
}

const SELECTOR = { token0: '0x0dfe1681', token1: '0xd21220a7', decimals: '0x313ce567' }

export async function resolvePoolIdentity(rpcUrl, poolAddress, hoodlAddress) {
  const [token0Hex, token1Hex] = await Promise.all([ethCall(rpcUrl, poolAddress, SELECTOR.token0), ethCall(rpcUrl, poolAddress, SELECTOR.token1)])
  const token0 = decodeAddressWord(token0Hex)
  const token1 = decodeAddressWord(token1Hex)
  const [decimals0Hex, decimals1Hex] = await Promise.all([ethCall(rpcUrl, token0, SELECTOR.decimals), ethCall(rpcUrl, token1, SELECTOR.decimals)])
  const hoodlIsToken0 = token0.toLowerCase() === hoodlAddress.toLowerCase()
  const hoodlIsToken1 = token1.toLowerCase() === hoodlAddress.toLowerCase()
  if (!hoodlIsToken0 && !hoodlIsToken1) {
    throw new Error('Configured pool does not contain the configured HOODL token as token0 or token1')
  }
  return { token0, token1, decimals0: Number(decodeUintWord(decimals0Hex)), decimals1: Number(decodeUintWord(decimals1Hex)), hoodlIsToken0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/poolSwapRpc.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/poolSwapRpc.mjs scripts/poolSwapRpc.test.mjs
git commit -m "feat: add chunked/backoff RPC client for swap backfill"
```

---

## Task 5: Wire swap indexing into the snapshot script

**Files:**
- Modify: `scripts/index-snapshot.mjs`

**Interfaces:**
- Consumes: everything exported by `scripts/poolSwapIndexer.mjs` (Task 3) and `scripts/poolSwapRpc.mjs` (Task 4).
- Produces: a `swaps` field on the written `snapshot` object, per the schema in the spec (`docs/superpowers/specs/2026-08-27-uniswap-v3-swap-indexing-design.md`), and bumps `schemaVersion` to `4`.

This task has no new automated test file — the pure logic it orchestrates is already covered by Tasks 1–4, and this task's own correctness is verified by actually running the script against the live chain in Task 6. It is still done via small, verifiable steps.

- [ ] **Step 1: Add imports and constants**

At the top of `scripts/index-snapshot.mjs`, after the existing `import { mkdir, readFile, writeFile } from 'node:fs/promises'` line, add:

```js
import { buildSwapDayBuckets, classifySwap, computeSwapActivity, decodeSwapLog, mergeSwapHistory, SWAP_TOPIC0, trimRecentSwaps } from './poolSwapIndexer.mjs'
import { ethBlockNumber, ethGetLogsChunked, fetchBlockTimestamps, resolvePoolIdentity } from './poolSwapRpc.mjs'
```

After the existing `const api = ...` line, add:

```js
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
const SWAP_CHUNK_SPAN = 2_000_000n
```

- [ ] **Step 2: Add the `indexPoolSwaps` function**

Add this function after `readPriorSnapshot` (before the `dayKey` function, so it sits with the other top-level helpers):

```js
// Indexes the configured pool's Swap events into a persistent, incrementally-
// updated ledger. Always resumes from the block after the last one it
// successfully covered (full genesis backfill on the very first run). Any
// failure during the chunk loop stops the loop but still returns whatever
// was actually confirmed — never claims coverage it doesn't have, and never
// throws away chunks that already succeeded this run.
async function indexPoolSwaps(priorSnapshot, nowDate) {
  const prior = priorSnapshot?.swaps ?? null
  const identity = await resolvePoolIdentity(RPC_URL, pool, token)
  const latest = await ethBlockNumber(RPC_URL)
  const fromBlock = prior?.indexing ? BigInt(prior.indexing.lastIndexedBlock) + 1n : 0n
  if (fromBlock > latest) {
    return prior ? { ...prior, identity } : null
  }

  let coverageStartMs = prior?.indexing?.coverageStartMs ?? null
  if (coverageStartMs === null) {
    const genesisTimestamps = await fetchBlockTimestamps(RPC_URL, [0n])
    coverageStartMs = genesisTimestamps.get(0n) ?? nowDate.getTime()
  }

  const decodedByBlock = []
  let lastGoodBlock = fromBlock - 1n
  let reachedLatest = false
  try {
    await ethGetLogsChunked({
      rpcUrl: RPC_URL,
      address: pool,
      topics: [SWAP_TOPIC0],
      fromBlock,
      toBlock: latest,
      chunkSpan: SWAP_CHUNK_SPAN,
      onChunk: async ({ toBlock, logs }) => {
        for (const log of logs) {
          try {
            const parsed = decodeSwapLog(log)
            decodedByBlock.push({ ...parsed, hash: log.transactionHash, blockNumber: Number.parseInt(log.blockNumber, 16) })
          } catch {
            // malformed log skipped, matches src/lib/poolSwaps.ts's live-path behavior
          }
        }
        lastGoodBlock = toBlock
      },
    })
    reachedLatest = true
  } catch (error) {
    console.warn(`Swap log chunk loop stopped early: ${error instanceof Error ? error.message : 'request failed'}`)
  }

  if (!prior && decodedByBlock.length === 0 && !reachedLatest) {
    // Total failure on the very first attempt: nothing verified yet, nothing to persist.
    return null
  }

  const blockNumbers = decodedByBlock.map((s) => BigInt(s.blockNumber))
  const timestamps = await fetchBlockTimestamps(RPC_URL, blockNumbers)
  const classified = decodedByBlock.flatMap((s) => {
    const timestampMs = timestamps.get(BigInt(s.blockNumber))
    if (timestampMs === undefined) return []
    const { side, hoodlAmount } = classifySwap({ amount0: s.amount0, amount1: s.amount1, hoodlIsToken0: identity.hoodlIsToken0 })
    return [{ blockNumber: s.blockNumber, timestampMs, sender: s.sender, hash: s.hash, side, hoodlAmount }]
  })

  const priorRecent = (prior?.recent ?? []).map((r) => ({ ...r, hoodlAmount: BigInt(r.hoodlAmount) }))
  const recent = trimRecentSwaps({ swaps: [...priorRecent, ...classified], nowMs: nowDate.getTime() })
  const priorHistory = (prior?.history ?? []).map((d) => ({ ...d, volumeHoodl: BigInt(d.volumeHoodl) }))
  const newDays = buildSwapDayBuckets({ swaps: classified, nowMs: nowDate.getTime(), cutoffMs: coverageStartMs })
  const history = mergeSwapHistory({ priorHistory, newDays })
  const activity = computeSwapActivity({ swaps: recent, nowMs: nowDate.getTime() })

  return {
    identity,
    indexing: { lastIndexedBlock: Number(lastGoodBlock), backfillComplete: reachedLatest, chunkBlockSpan: Number(SWAP_CHUNK_SPAN), coverageStartMs },
    recent: recent.map((r) => ({ ...r, hoodlAmount: r.hoodlAmount.toString() })),
    history: history.map((d) => ({ ...d, volumeHoodl: d.volumeHoodl.toString() })),
    activity: { ...activity, volume24hHoodl: activity.volume24hHoodl.toString() },
  }
}
```

- [ ] **Step 3: Call it and attach the result, isolated from transfer/holder failures**

Find the existing block near the end of the file:

```js
snapshot.holders = holders
snapshot.holdersComplete = holdersComplete
await mkdir('public/data', { recursive: true })
```

Replace it with:

```js
snapshot.holders = holders
snapshot.holdersComplete = holdersComplete

try {
  snapshot.swaps = await indexPoolSwaps(priorSnapshot, now)
} catch (error) {
  console.warn(`Swap indexing unavailable: ${error instanceof Error ? error.message : 'request failed'}`)
  snapshot.swaps = priorSnapshot?.swaps ?? null
}

await mkdir('public/data', { recursive: true })
```

- [ ] **Step 4: Bump the schema version**

Find:

```js
const snapshot = {
  schemaVersion: 3,
```

Replace with:

```js
const snapshot = {
  schemaVersion: 4,
```

- [ ] **Step 5: Run the existing test suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS (all existing tests still pass; this task adds no new test file, so the count should match the pre-task baseline).

- [ ] **Step 6: Commit**

```bash
git add scripts/index-snapshot.mjs
git commit -m "feat: index verified Uniswap V3 pool swaps into the snapshot"
```

---

## Task 6: Surface swap data in `mergeIndexedState` and the Trading tab

**Files:**
- Modify: `src/lib/mergeIndexedState.ts`
- Modify: `src/lib/mergeIndexedState.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces on `IndexedState`: `swapActivity: SwapActivitySnapshot | null`, `swapsSource: FieldSource`, `swapIndexing: SwapIndexingMeta | null`, where `export interface SwapActivitySnapshot { swaps24h: number; volume24hHoodl: string; buyCount24h: number; sellCount24h: number; uniqueTraders24h: number }` and `export interface SwapIndexingMeta { lastIndexedBlock: number; backfillComplete: boolean; coverageStartMs: number }`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/mergeIndexedState.test.ts` (new `describe` block, keep existing tests untouched):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mergeIndexedState.test.ts`
Expected: FAIL — `state.swapActivity` is `undefined`, not matching the expected object (property doesn't exist yet).

- [ ] **Step 3: Extend `mergeIndexedState.ts`**

Add near the top, after the existing `SnapshotCoverage` interface:

```ts
export interface SwapActivitySnapshot {
  swaps24h: number
  volume24hHoodl: string
  buyCount24h: number
  sellCount24h: number
  uniqueTraders24h: number
}

export interface SwapIndexingMeta {
  lastIndexedBlock: number
  backfillComplete: boolean
  coverageStartMs: number
}
```

Extend the `Snapshot` interface (add a field after `coverage?: SnapshotCoverage`):

```ts
  swaps?: {
    activity?: SwapActivitySnapshot
    indexing?: SwapIndexingMeta
  }
```

Extend the `IndexedState` interface (add fields after `error: string | null`):

```ts
  swapActivity: SwapActivitySnapshot | null
  swapsSource: FieldSource
  swapIndexing: SwapIndexingMeta | null
```

In the `mergeIndexedState` function body, add before the `return`:

```ts
  const swapActivity = snapshot?.swaps?.activity ?? null
  const swapIndexing = snapshot?.swaps?.indexing ?? null
```

And add to the returned object (this pipeline is snapshot-only — there is no live equivalent — so the source is always `'snapshot'` when present, `'unavailable'` otherwise):

```ts
    swapActivity,
    swapsSource: swapActivity ? 'snapshot' : 'unavailable',
    swapIndexing,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mergeIndexedState.test.ts`
Expected: PASS (all existing + 2 new tests)

- [ ] **Step 5: Also update the empty `IndexedState` initializer in `src/App.tsx`**

Find, in the `App` function:

```ts
const [indexed, setIndexed] = useState<IndexedState>({ holders: null, priceUsd: null, volume24h: null, transfers: [], activity: null, history: [], holderRows: [], snapshotAt: null, snapshotStale: false, transfersStale: false, transfersSource: 'unavailable', holdersSource: 'unavailable', coverage: null, error: null })
```

Replace with:

```ts
const [indexed, setIndexed] = useState<IndexedState>({ holders: null, priceUsd: null, volume24h: null, transfers: [], activity: null, history: [], holderRows: [], snapshotAt: null, snapshotStale: false, transfersStale: false, transfersSource: 'unavailable', holdersSource: 'unavailable', coverage: null, error: null, swapActivity: null, swapsSource: 'unavailable', swapIndexing: null })
```

- [ ] **Step 6: Add the new metrics to the Trading tab**

Find the `Trading` branch of `TabContent`:

```tsx
if (tab === 'Trading') return <><div className="metrics"><Metric label="Swap events" value={swaps.length ? formatInteger(swaps.length) : '—'} source={swaps.length ? 'Indexed' : 'Unavailable'} error={swaps.length ? null : 'Direct pool log query returned no verified events'} /><Metric label="Verified transfers" value={indexed.transfers.length ? formatInteger(indexed.transfers.length) : '—'} source={indexed.transfers.length ? 'Indexed' : 'Unavailable'} error={indexed.transfers.length ? null : indexed.error} /><Metric label="HOODL volume" value={swapVolume(swaps, poolV3, token.decimals)} source={swaps.length && token.decimals !== null ? 'Calculated' : 'Unavailable'} error={swaps.length && token.decimals !== null ? null : 'Bounded pool swap volume unavailable'} /><Metric label="Unique traders" value={swaps.length ? formatInteger(new Set(swaps.map((swap) => swap.sender.toLowerCase())).size) : '—'} source={swaps.length ? 'Calculated' : 'Unavailable'} /></div><Chart title="Transfer activity" subtitle="Verified token transfers · bounded source coverage" activity={indexed.activity} coverageComplete7d={indexed.coverage?.coverageComplete7d} history={indexed.history} /><TransferActivity transfers={indexed.transfers} decimals={token.decimals} stale={indexed.transfersStale} error={indexed.error} /></>
```

Replace with:

```tsx
if (tab === 'Trading') {
  const swapActivity = indexed.swapActivity
  return <>
    <div className="metrics"><Metric label="Swap events" value={swaps.length ? formatInteger(swaps.length) : '—'} source={swaps.length ? 'Indexed' : 'Unavailable'} error={swaps.length ? null : 'Direct pool log query returned no verified events'} /><Metric label="Verified transfers" value={indexed.transfers.length ? formatInteger(indexed.transfers.length) : '—'} source={indexed.transfers.length ? 'Indexed' : 'Unavailable'} error={indexed.transfers.length ? null : indexed.error} /><Metric label="HOODL volume" value={swapVolume(swaps, poolV3, token.decimals)} source={swaps.length && token.decimals !== null ? 'Calculated' : 'Unavailable'} error={swaps.length && token.decimals !== null ? null : 'Bounded pool swap volume unavailable'} /><Metric label="Unique traders" value={swaps.length ? formatInteger(new Set(swaps.map((swap) => swap.sender.toLowerCase())).size) : '—'} source={swaps.length ? 'Calculated' : 'Unavailable'} /></div>
    <div className="metrics" style={{ marginTop: 20 }}>
      <Metric label="24h volume (indexed)" value={swapActivity && token.decimals !== null ? `${formatUnits(BigInt(swapActivity.volume24hHoodl), token.decimals)} HOODL` : '—'} source={swapActivity ? 'Indexed' : 'Unavailable'} error={swapActivity ? null : 'Verified swap snapshot unavailable'} accent />
      <Metric label="24h buys / sells" value={swapActivity ? `${formatInteger(swapActivity.buyCount24h)} / ${formatInteger(swapActivity.sellCount24h)}` : '—'} source={swapActivity ? 'Indexed' : 'Unavailable'} error={swapActivity ? null : 'Verified swap snapshot unavailable'} />
      <Metric label="24h unique traders" value={swapActivity ? formatInteger(swapActivity.uniqueTraders24h) : '—'} source={swapActivity ? 'Indexed' : 'Unavailable'} error={swapActivity ? null : 'Verified swap snapshot unavailable'} />
    </div>
    <div className="source-note">24h volume, buy/sell, and trader figures come from a persisted, chunked eth_getLogs index of this pool's full Swap-event history, refreshed every 15 minutes — not from the bounded live RPC window above. &quot;Trader&quot; means a unique Swap-event sender address, which is not always the same as a unique wallet.</div>
    <Chart title="Transfer activity" subtitle="Verified token transfers · bounded source coverage" activity={indexed.activity} coverageComplete7d={indexed.coverage?.coverageComplete7d} history={indexed.history} /><TransferActivity transfers={indexed.transfers} decimals={token.decimals} stale={indexed.transfersStale} error={indexed.error} />
  </>
}
```

- [ ] **Step 7: Run the full test suite, lint, and build**

Run: `npm test && npm run lint && npm run build`
Expected: all three pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mergeIndexedState.ts src/lib/mergeIndexedState.test.ts src/App.tsx
git commit -m "feat: surface indexed 24h swap volume, buy/sell, and trader counts in the Trading tab"
```

---

## Task 7: Run the real indexer once and verify end-to-end

**Files:**
- Modify: `public/data/snapshot.json` (generated output, not hand-edited)

This task runs the actual script against the live chain to confirm the whole pipeline works, per the project's "verified data only" rule — this cannot be confirmed by unit tests alone since it depends on real RPC behavior.

- [ ] **Step 1: Run the snapshot script**

Run: `node scripts/index-snapshot.mjs`
Expected: exits 0, logs `Wrote N verified transfers at ...`, and does not print `Swap indexing unavailable`. This performs a full historical backfill on first run (chunked `eth_getLogs` calls over ~55 days of chain history) — expect it to take up to a minute or two, not multiple hours, based on the block-range probing done during design.

- [ ] **Step 2: Inspect the written snapshot**

Run: `node -e "const s = require('./public/data/snapshot.json'); console.log(JSON.stringify({ schemaVersion: s.schemaVersion, identity: s.swaps?.identity, indexing: s.swaps?.indexing, activity: s.swaps?.activity, historyDays: s.swaps?.history?.length, recentRows: s.swaps?.recent?.length }, null, 2))"`

Verify manually:
- `schemaVersion` is `4`.
- `swaps.identity.hoodlIsToken0` is a boolean (not `null`/`undefined`).
- `swaps.indexing.backfillComplete` is `true` and `lastIndexedBlock` is close to the chain's current latest block.
- `swaps.activity` and `swaps.history` are present (`history` may legitimately be an empty array if the pool is very young relative to full UTC days, but the field must exist).

If `backfillComplete` is `false` or the swap fields are missing, do not proceed — investigate the RPC error printed to stderr before continuing (per the "verified data only" instruction, do not paper over a failed indexing run).

- [ ] **Step 3: Run the full verification suite**

Run: `npm test && npm run lint && npm run build`
Expected: all three pass, using the newly-written `public/data/snapshot.json`.

- [ ] **Step 4: Commit the refreshed snapshot**

```bash
git add public/data/snapshot.json
git commit -m "chore: index verified pool swap history into the snapshot"
```

Do not push. Ask the user before pushing to `main`, consistent with normal repository practice (this branch already contains several manual "chore: refresh verified data snapshot" commits made the same way).

---

## Self-Review Notes

- **Spec coverage:** full historical backfill (Task 5/7), 30-day rolling raw window + permanent day-bucket history (Tasks 2/3/5), buy/sell classification (Tasks 1/3), trader = unique `sender` with documented caveat (Tasks 1/3/6), schema v4 with graceful degradation on old snapshots (Task 6), independent failure domain from transfer/holder indexing (Task 5), metrics-only Trading tab surfacing (Task 6) — all covered. USD pricing/fees/TVL/leaderboard explicitly out of scope, not touched.
- **Type consistency checked:** `SwapSide`, `ClassifiedSwap`, `SwapDayBucket`, `SwapActivity` names and shapes are identical between Task 1/2 (TypeScript) and Task 3 (plain JS reimplementation); `SwapActivitySnapshot`/`SwapIndexingMeta` field names in Task 6 match exactly what Task 5 writes into `snapshot.swaps.activity` / `snapshot.swaps.indexing` (`volume24hHoodl` as a string in both places, `lastIndexedBlock`/`backfillComplete`/`coverageStartMs` field names match).
- **No placeholders:** every step has real, complete code; no "add error handling" or "TBD" steps remain.
