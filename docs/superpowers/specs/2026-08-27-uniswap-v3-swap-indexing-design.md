# Uniswap V3 Swap Event Indexing — Design Spec

Date: 2026-08-27
Status: Approved for planning

## Problem

HOODL Analytics currently has no verified, persistent record of Uniswap V3
swap activity for the configured HOODL/WETH pool
(`0xF87761231646DA4aa00905c237EaCbfF112Df930`). The only existing swap data
path (`src/lib/poolSwaps.ts` → `getRecentPoolSwaps`) queries
`eth_getLogs` live from the browser over a fixed 50,000-block window. On
Robinhood Chain (chain id 4663) block time is ~0.1s, so that window covers
only ~1.4 hours — nowhere near enough for a truthful "24h volume" figure,
and it computes no buy/sell split and no trader count at all in the
snapshot data (only ad hoc "unique senders" in the live-only UI path).

This spec covers building a real, persistent, verified index of pool Swap
events with 24h volume, buy/sell classification, and trader counts — the
single most important missing data pipeline identified in the prior
codebase analysis.

## Constraints confirmed via live RPC probing (2026-08-27)

- Chain block time ≈ 0.101s/block. Chain is ~55 days old at time of writing
  (latest block ≈ 47,463,072).
- `eth_getLogs` over the full history (block 0 → latest) times out
  (`"log query timed out"`). Chunked ranges of up to 20,000,000 blocks
  succeed in under ~2.5s; 2,000,000–5,000,000-block chunks are fast and
  reliable (~0.2–0.5s).
- The RPC enforces a rate limit: rapid consecutive requests can return
  HTTP/JSON-RPC error `429 Too Many Requests`. A chunking loop must pace
  requests and back off on 429.
- The RPC endpoint supports JSON-RPC batch requests (a JSON array body) —
  usable to fetch block timestamps for many distinct blocks in one round
  trip instead of one `eth_getBlockByNumber` call per block.
- Real swap logs sampled from a 2,000,000-block window (22 swaps) show 5
  distinct `sender` addresses and 6 distinct `recipient` addresses — `sender`
  is not a single dominant router address here, so unique `sender` is a
  usable (if not perfect) proxy for "unique trader" on this pool. This is
  documented as an approximation, not silently assumed.

## Decisions (confirmed with user)

1. **Full historical backfill.** On first run, index the entire ~55-day
   pool history via chunked `eth_getLogs`, not just a rolling window
   starting now. Subsequent runs index incrementally from the last
   indexed block.
2. **Rolling window for raw rows, permanent day-bucket aggregates.**
   Individual swap rows (`recent`) are kept only for a bounded rolling
   window (30 days) to bound `snapshot.json` size, matching the existing
   `MAX_HISTORY_DAYS` pattern for transfers. Day-bucketed aggregates
   (volume, buy count, sell count, unique traders) are retained forever,
   never overwritten, only appended once a day is fully closed — mirroring
   the existing `closedDayCounts`/`history` merge logic for transfers.
3. **Metrics only, no leaderboard.** This iteration produces aggregate
   numbers (unique traders, buy/sell counts, 24h volume) only. No
   per-address trading leaderboard/ranking UI in this pass.

## Architecture

No new infrastructure. This extends the existing static-site + 15-minute
GitHub Actions cron pattern (`scripts/index-snapshot.mjs` →
`public/data/snapshot.json` → committed to the repo → served as a static
file → merged client-side with live reads).

### 1. Pure, tested core logic — `src/lib/`

New TypeScript module(s), side-effect-free, unit-tested with Vitest
(pattern: `mergeIndexedState.ts` / `historyRange.ts`):

- **Swap classification**: given a decoded swap's `amount0`/`amount1` and
  whether HOODL is `token0` or `token1`, return `{ side: 'buy' | 'sell',
  hoodlAmount: bigint }`.
  - `side = 'buy'` when the HOODL-side signed amount is negative (pool
    sent HOODL to the trader).
  - `side = 'sell'` when the HOODL-side signed amount is positive (trader
    sent HOODL to the pool).
- **Day-bucket aggregation**: given a list of classified, timestamped
  swaps and a coverage window, produce per-UTC-day
  `{ date, volumeHoodl, buyCount, sellCount, uniqueTraders }` rows, plus
  24h/1h activity counters. Follows the same "never fabricate a closed day
  as zero outside the verified coverage window" rule as
  `closedDayCounts` in the existing script.
- **History merge**: merge newly-closed days into prior history without
  ever overwriting a previously-recorded closed day (same rule as the
  existing transfer history merge).
- **Rolling-window trim**: given the merged raw swap rows and "now", drop
  rows older than 30 days.

This logic is implemented once, in TypeScript, under `src/lib/`, and is
unit-tested directly. It is **not** imported by the Node snapshot script
(see below) — the classification formula is small enough (a sign check)
that it is reimplemented in the script's plain-JS runtime and tested
there independently, so both implementations are verified against
equivalent test cases without requiring cross-runtime module sharing.

### 2. Script-side RPC + indexing — `scripts/index-snapshot.mjs`

Extends the existing plain-Node-ESM script (no build step; runs via
`node scripts/index-snapshot.mjs` in CI). Adds, self-contained in the
script (matching the script's existing pattern of not importing
`src/lib/*.ts`, and duplicating hardcoded addresses rather than importing
`config.ts`):

- A minimal JSON-RPC client: `ethCall`, `ethGetLogs`, `eth_blockNumber`,
  and a **batched** `eth_getBlockByNumber` for timestamps (one HTTP POST
  with a JSON array of requests for all distinct block numbers in a page
  of results).
- A chunked backfill loop: fetch `Swap` logs in fixed-size block-range
  chunks (2,000,000 blocks per chunk — chosen from the probe results as
  fast and comfortably under the range that times out), advancing forward
  from `lastIndexedBlock` (or block 0 on first run) to latest. Pace
  requests with a short delay between chunks; on HTTP/JSON-RPC 429, retry
  with exponential backoff (bounded retry count, then abort the run
  cleanly — see error handling below).
- Pool identity resolution: `token0()`, `token1()`, and `decimals()` on
  both tokens via `eth_call`, to determine `hoodlIsToken0` — never
  assumed, matching `src/lib/uniswapV3.ts`'s existing philosophy.
- Swap log decoding: reimplements the existing, already-verified decode
  logic from `src/lib/uniswapV3Swaps.ts` (topic/data layout is fixed and
  small) directly in the script.
- Applies the buy/sell classification (script-local reimplementation, see
  above) and builds the day buckets / rolling window / merge, mirroring
  the transfer-history logic already in the script.

### 3. Frontend — moderate Trading-tab update

`src/App.tsx`'s "Trading" tab currently shows only bounded, live
50k-block swap stats. It is updated to also surface the new
snapshot-verified fields (24h volume, buy/sell counts, 24h unique
traders), clearly labeled with source and coverage (e.g. "Indexed ·
snapshot" vs the existing live "Indexed" bounded-window numbers), using
the same `Metric`/`Badge`/source-note conventions already used elsewhere
in the file. No new tab, no leaderboard UI.

`mergeIndexedState.ts` (or a small sibling merge function) is extended to
read the new `swaps` section of `Snapshot` and expose it as part of
`IndexedState`, following the existing live-vs-snapshot merge pattern.

## Data model — `snapshot.json` schema v4

`schemaVersion` bumps from 3 to 4. New top-level `swaps` object:

```jsonc
{
  "schemaVersion": 4,
  // ...existing fields unchanged...
  "swaps": {
    "identity": {
      "token0": "0x...",
      "token1": "0x...",
      "decimals0": 18,
      "decimals1": 18,
      "hoodlIsToken0": false
    },
    "indexing": {
      "lastIndexedBlock": 47463072,
      "backfillComplete": true,
      "chunkBlockSpan": 2000000
    },
    "recent": [
      {
        "hash": "0x...",
        "blockNumber": 47463010,
        "timestamp": "2026-08-27T10:15:00.000Z",
        "sender": "0x...",
        "side": "buy",
        "hoodlAmount": "12345678900000000000"
      }
      // rolling 30-day window only
    ],
    "history": [
      {
        "date": "2026-08-01",
        "volumeHoodl": "98765432100000000000000",
        "buyCount": 12,
        "sellCount": 9,
        "uniqueTraders": 14
      }
      // permanent, append-only per verified closed UTC day
    ],
    "activity": {
      "swaps24h": 21,
      "volume24hHoodl": "5432100000000000000000",
      "buyCount24h": 11,
      "sellCount24h": 10,
      "uniqueTraders24h": 8
    }
  }
}
```

Amounts are serialized as decimal-string integers (token base units, like
existing transfer `value` fields) to avoid JSON number precision loss;
formatting to human units happens client-side via the existing
`formatUnits` helper.

## Error handling / "verified only" guarantees

- If pool identity resolution (`token0`/`token1`/`decimals`) fails, the
  run aborts without writing a `swaps` section change — never guesses
  which token is HOODL.
- If the chunked backfill loop fails partway (RPC error, exhausted 429
  retries) before reaching `latest`, the run does **not** advance
  `lastIndexedBlock` past the last fully-fetched chunk, and does not mark
  `backfillComplete: true`. Partial progress within the run is still
  persisted (chunks already fetched are kept), so a failed run never loses
  ground, but the snapshot never silently claims complete coverage it
  doesn't have.
- Day-bucket history follows the existing rule: a UTC day is only ever
  recorded once it is fully closed and fully within verified coverage; it
  is never recorded as a zero-volume day merely because no swaps were
  seen, unless that day's block range was actually confirmed indexed.
- `recent` rows and `activity` figures are computed only from
  successfully decoded logs; malformed logs are skipped (matching the
  existing `getRecentPoolSwaps` behavior).
- Trader count is documented (in code comments and UI copy) as "unique
  Swap-event `sender` addresses", not "unique wallets" — an accurate,
  non-overclaiming label.
- Swap indexing is an independent failure domain from transfer/holder
  indexing in the script: a swap-indexing failure (RPC error, exhausted
  retries, pool-identity resolution failure) is caught, logged, and
  leaves the existing `swaps` section of `snapshot.json` untouched — it
  must never abort the whole script run or block the transfer/holder
  snapshot from being written, matching how holder-ranking failures are
  already isolated in the existing script (`try`/`catch` around the
  holders block, independent of the transfer block that can still throw
  and fail the run today).

## Testing

Vitest unit tests (new or extended):

- Swap classification: buy vs sell for both `hoodlIsToken0 = true` and
  `false`, including zero-amount and sign edge cases.
- Day-bucket aggregation: correct bucketing across UTC day boundaries,
  correct exclusion of the in-progress "today" bucket and any day outside
  verified coverage, correct 24h/1h activity windows.
- History merge: prior closed days are never overwritten; only new closed
  days are appended; ordering and 90-day-equivalent retention.
- Rolling-window trim: rows older than 30 days are dropped; boundary case
  at exactly 30 days.
- Script-side reimplementation: equivalent test cases run against the
  script's own classification/aggregation functions (imported directly
  into a Vitest test file, since Vitest can execute `.mjs` modules
  without a build step) to keep the two implementations in verified
  parity.
- `mergeIndexedState` extension: snapshot `swaps` data surfaces correctly
  into `IndexedState`, absence of a `swaps` section (old snapshot schema)
  degrades to "Unavailable" rather than crashing.

`npm test`, `npm run lint`, and `npm run build` must all pass before this
work is considered done, per existing CI gates (`ci.yml`).

## Out of scope (tracked separately)

USD pricing, fee/reward computation, TVL history, and a top-trader
leaderboard remain open follow-up items, not part of this change.
