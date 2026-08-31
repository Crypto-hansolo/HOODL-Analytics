# HOODL Analytics

A read-only analytics terminal for the HOODL token on **Robinhood Chain** (chain id `4663`). Every figure is either read live from a public RPC/Blockscout endpoint, calculated from values read that way, or explicitly marked **Unavailable** — nothing is estimated, guessed, or backfilled with placeholder data.

Live app: deployed to GitHub Pages from `main` (see `.github/workflows/deploy.yml`).

## Data sources

| Source | Used for | Notes |
| --- | --- | --- |
| Robinhood Chain RPC (`https://rpc.mainnet.chain.robinhood.com`) | Token contract reads (`name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`), chain id/block number, Uniswap V3 pool state (`slot0`, `liquidity`, `fee`, `token0`/`token1`), pool `Swap` event logs | Read-only `eth_call`/`eth_getLogs`/`eth_blockNumber`. No write calls, no private key anywhere in this repo. |
| Blockscout API v2 (`https://robinhoodchain.blockscout.com/api/v2`) | Token metadata, recent transfers, holder ranking, WETH/USD exchange rate (used only to convert the on-chain WETH/HOODL spot quote to an approximate USD figure) | Sits behind Cloudflare — see [Known limitations](#known-limitations). |
| `public/data/snapshot.json` (repository snapshot) | Fallback for transfers/holders/activity when a live browser request fails or is CORS-blocked; primary source for the persisted Swap-event index (24h volume, buy/sell counts, unique traders) | Refreshed by a scheduled GitHub Action, not by the browser. See below. |

The frontend always prefers a live browser-side read; the snapshot is a fallback that the UI labels `snapshot fallback` (see `src/lib/mergeIndexedState.ts`) rather than silently presenting as live. The persisted Swap-event index in the snapshot (`snapshot.swaps`) has no live-browser equivalent — an unbounded Swap-log backfill isn't something a browser tab should do on every page load — so it is always sourced from the snapshot and labeled `Indexed`.

**USD prices are never fetched from a third-party price API.** The only USD figure shown is derived by multiplying the on-chain WETH/HOODL spot quote (from the pool's `slot0.sqrtPriceX96`) by Blockscout's own indexed USD exchange rate for whichever pool token is verified as WETH (checked dynamically via `symbol()`, never assumed) — and the UI always labels this as derived, with the calculation shown in a tooltip.

## Refresh / indexer workflow

Two independent pieces keep `public/data/snapshot.json` current:

1. **`scripts/index-snapshot.mjs`** — paginates Blockscout's transfers endpoint (up to 20 pages) to build a rolling 7-day transfer/activity/holder snapshot, then calls `indexPoolSwaps()` (same file) to advance the persisted Swap-event index.
2. **`indexPoolSwaps()`** — a resumable indexer over the configured pool's Uniswap V3 `Swap` event (topic0 `0xc42079f9…`). On the first run it backfills from block 0 to the chain tip in `2,000,000`-block `eth_getLogs` chunks; every later run resumes from `lastIndexedBlock + 1`. It **never claims coverage it doesn't have** — if the chunk loop fails partway through (RPC timeout/rate limit), it persists exactly the range it actually confirmed and resumes from there next time, rather than restarting or leaving stale `Unavailable` state after real progress. Decoded swaps are classified buy/sell using verified `token0`/`token1` pool identity (never assumed) and aggregated into `recent` (rolling 30-day window), `history` (per-UTC-day volume, append-only — a prior day's closed number is never recomputed or overwritten), and `activity` (24h volume/buy-sell/unique-trader counts).

Run it locally with:

```bash
node scripts/index-snapshot.mjs
```

It's safe to re-run — everything is either resumed from where it left off or freshly re-fetched. It writes `public/data/snapshot.json` only on success (a hard transfer-pagination failure throws instead of overwriting a good snapshot with an empty one).

**Scheduling**: `.github/workflows/snapshot.yml` runs this script every 15 minutes, commits the snapshot if it changed, and — since a `GITHUB_TOKEN` push doesn't itself trigger a Pages deployment — explicitly dispatches `deploy.yml`.

**Freshness in the UI**: `SNAPSHOT_STALE_AFTER_MS` (`src/config.ts`) is 2× the 15-minute cron interval, giving headroom for scheduler jitter before a merely on-cadence snapshot gets mislabeled `stale`. The Data Integrity panel (Overview tab) surfaces snapshot age, transfer/holder source (`live` vs `snapshot fallback`), 7-day coverage completeness, and the Swap index's own `lastIndexedBlock`/backfill status.

## Known limitations

- **Blockscout requires a browser-like `User-Agent`.** Blockscout sits behind Cloudflare, which returns an HTTP 403 challenge page to requests with no `User-Agent` header — which is what Node's `fetch()` sends by default. `scripts/blockscoutClient.mjs` sets one explicitly for the indexer script; real browsers already send one, so the deployed frontend was never affected. If you see `Blockscout HTTP 403` from a Node script talking to Blockscout, this is almost certainly why.
- **The Swap-event backfill is genuinely large.** The pool has been live long enough that a first-time genesis-to-tip backfill is ~26 chunks of up to 2,000,000 blocks each. Individual chunks with a lot of log data can hit the public RPC node's own request timeout, and the shared RPC/Blockscout edge intermittently rate-limits (`HTTP 429`) under sustained request volume. The indexer's chunk loop and `rpcCallWithBackoff` retry (`scripts/poolSwapRpc.mjs`) are both designed to make partial, resumable progress rather than fail outright — but depending on when a given run executes, `public/data/snapshot.json`'s `swaps` field may still be catching up rather than fully caught up to the chain tip. When it hasn't caught up yet, every Swap-derived figure (24h volume, buy/sell counts, unique traders, Overview's 24h volume fallback) is shown as **Unavailable**, never estimated.
- **Fees & Rewards remain intentionally Unavailable.** Verified swap volume alone isn't enough to safely show "generated fees" or "WETH distributed": fees require correctly identifying each swap's input-side token and matching it against the pool's `feeTier` (ideally cross-checked against the pool's own `feeGrowthGlobal0X128`/`feeGrowthGlobal1X128` accumulators, which this app does not yet read), and reward/distribution figures require a specific, verified reward contract or event that has not been identified for this token. The Fees & Rewards tab documents this and the concrete next verified step rather than approximating from transfer data.
- **Nothing is ever derived from plain ERC-20 transfers.** Transfers are shown as transfers (recent activity, counts) and are never used to infer swap volume, fees, or rewards — those require actual DEX `Swap` events or a verified reward contract, which is exactly the distinction this app is built to preserve.

## Development

```bash
npm install
npm run dev      # Vite dev server
npm test         # vitest — src/ (frontend) and scripts/ (indexer) test suites
npm run lint     # oxlint
npm run build    # tsc -b && vite build
```

`scripts/*.mjs` are run directly by Node (no build step) and are duplicated rather than imported from `src/` in a couple of places (e.g. `scripts/poolSwapIndexer.mjs` mirrors `src/lib/poolSwapDirection.ts`/`src/lib/poolSwapHistory.ts`) — both sides are covered by parity test fixtures so a regression in one shows up as a test failure, not a silent drift.
