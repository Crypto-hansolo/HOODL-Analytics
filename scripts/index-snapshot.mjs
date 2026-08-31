import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { blockscoutGet } from './blockscoutClient.mjs'
import { buildSwapDayBuckets, classifySwap, computeSwapActivity, decodeSwapLog, mergeSwapHistory, SWAP_TOPIC0, trimRecentSwaps } from './poolSwapIndexer.mjs'
import { ethBlockNumber, ethGetLogsChunked, fetchBlockTimestamps, resolvePoolIdentity } from './poolSwapRpc.mjs'

const token = '0x9fb3c2D71424122a5886DaC627177385d185DF09'
const pool = '0xF87761231646DA4aa00905c237EaCbfF112Df930'
const api = 'https://robinhoodchain.blockscout.com/api/v2'
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
const SWAP_CHUNK_SPAN = 2_000_000n
const SNAPSHOT_PATH = 'public/data/snapshot.json'
const MAX_HISTORY_DAYS = 90
const DAY_MS = 24 * 3600_000

async function readPriorSnapshot() {
  try {
    return JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'))
  } catch {
    return null
  }
}

// Indexes the configured pool's Swap events into a persistent, incrementally-
// updated ledger. Always resumes from the block after the last one it
// successfully covered (full genesis backfill on the very first run). Any
// failure during the chunk loop stops the loop but still returns whatever
// was actually confirmed — never claims coverage it doesn't have, and never
// throws away chunks that already succeeded this run.
export async function indexPoolSwaps(priorSnapshot, nowDate) {
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

  // Only bail with nothing persisted when NO chunk succeeded at all (the very
  // first eth_getLogs call failed before lastGoodBlock could advance past
  // fromBlock - 1) and there is no prior indexed state to fall back to.
  // Otherwise persist whatever range was actually confirmed — e.g. a
  // rate-limited (429) chunk loop that got through the first N chunks with
  // zero matching events still means those N chunks are verified clear, so
  // the next scheduled run resumes from lastGoodBlock + 1 instead of
  // restarting the whole backfill from genesis and hitting the same limit.
  if (!prior && lastGoodBlock < fromBlock) {
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

// UTC calendar day key, e.g. "2026-08-27".
function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

// Real, verified per-day transfer counts for every UTC calendar day that
// falls entirely within the guaranteed-complete coverage window
// [cutoff, now) — i.e. strictly before today (still in progress) and
// strictly after the pagination cutoff (which may only be partially
// covered). Days outside that window are never fabricated as zero.
function closedDayCounts(datedTransfers, nowDate, cutoffMs) {
  const todayStart = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate())
  const firstCoveredDayStart = Math.ceil(cutoffMs / DAY_MS) * DAY_MS
  const counts = new Map()
  for (let dayStart = firstCoveredDayStart; dayStart < todayStart; dayStart += DAY_MS) {
    counts.set(dayKey(dayStart), 0)
  }
  for (const row of datedTransfers) {
    const ts = new Date(row.timestamp).getTime()
    const dayStart = Date.UTC(new Date(ts).getUTCFullYear(), new Date(ts).getUTCMonth(), new Date(ts).getUTCDate())
    if (dayStart < firstCoveredDayStart || dayStart >= todayStart) continue
    const key = dayKey(dayStart)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([date, transferCount]) => ({ date, transferCount })).sort((a, b) => a.date.localeCompare(b.date))
}

async function get(path) {
  return blockscoutGet(api, path)
}

const MAX_PAGES = 20

export async function main() {
  const now = new Date()
  const cutoff = now.getTime() - 7 * 24 * 3600_000
  const transfers = []
  const holders = []
  let holdersComplete = false
  let nextParams = {}
  let pagesFetched = 0
  let coverageComplete7d = false
  let transferIndexError = null

  while (pagesFetched < MAX_PAGES) {
    const query = new URLSearchParams(nextParams).toString()
    let raw
    try {
      raw = await get(`/tokens/${token}/transfers?${query}`)
    } catch (error) {
      transferIndexError = error instanceof Error ? error.message : 'request failed'
      break
    }
    pagesFetched += 1
    const page = (raw.items ?? []).flatMap((item) => {
      const hash = item.transaction_hash ?? item.tx_hash
      const from = item.from?.hash
      const to = item.to?.hash
      const value = item.total?.value
      if (!hash || !from || !to || value === undefined) return []
      return [{ hash, from, to, value, timestamp: item.timestamp ?? null, blockNumber: item.block_number ?? null }]
    })
    transfers.push(...page)
    const datedPage = page.filter((row) => row.timestamp).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    if (datedPage[0] && new Date(datedPage[0].timestamp).getTime() <= cutoff) {
      coverageComplete7d = true
      break
    }
    const params = raw.next_page_params
    if (!params || typeof params !== 'object' || Object.keys(params).length === 0) break
    nextParams = params
  }
  if (pagesFetched === 0) {
    throw new Error(`No transfer snapshot written: ${transferIndexError ?? 'indexer returned no page'}`)
  }
  const dated = transfers.filter((row) => row.timestamp)
  const counts = (hours) => dated.filter((row) => now.getTime() - new Date(row.timestamp).getTime() <= hours * 3600_000).length
  const oldestTransferAt = dated.length ? dated.reduce((oldest, row) => new Date(row.timestamp) < new Date(oldest) ? row.timestamp : oldest, dated[0].timestamp) : null

  // History is a rolling ledger of verified per-day transfer counts, built up
  // run over run. A prior run's closed days are never overwritten or
  // re-derived — only newly-closed days (never seen before) are appended —
  // so a run with incomplete coverage can never erase previously verified
  // history.
  const priorSnapshot = await readPriorSnapshot()
  const priorHistory = Array.isArray(priorSnapshot?.history) ? priorSnapshot.history : []
  let history = priorHistory
  if (coverageComplete7d) {
    const merged = new Map(priorHistory.map((day) => [day.date, day]))
    for (const day of closedDayCounts(dated, now, cutoff)) {
      if (!merged.has(day.date)) merged.set(day.date, day)
    }
    history = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_HISTORY_DAYS)
  }

  const snapshot = {
    schemaVersion: 4,
    generatedAt: now.toISOString(),
    source: { name: 'Blockscout API v2', url: `${api}/tokens/${token}/transfers`, chainId: 4663, token, pool },
    coverage: { kind: 'recent-token-transfers', pagesFetched, maxPages: MAX_PAGES, coverageComplete7d, oldestTransferAt, note: coverageComplete7d ? 'Transfer activity is complete through the last 7 days at snapshot time. Pool swaps, fees, rewards, and holder ranking are not inferred from transfers.' : `Only a bounded prefix of the transfer index was returned${transferIndexError ? `; pagination stopped after an indexer error (${transferIndexError})` : ''}. Activity counts are lower bounds. Pool swaps, fees, rewards, and holder ranking are not inferred from transfers.` },
    transfers,
    activity: { transfers1h: counts(1), transfers24h: counts(24), transfers7d: counts(24 * 7) },
    history,
  }
  // Holder ranking is a separate Blockscout index. Keep it in the repository
  // snapshot as an optional fallback, but never make a missing ranking block a
  // verified transfer snapshot.
  try {
    let holderParams = {}
    for (let page = 0; page < 3; page += 1) {
      const query = new URLSearchParams(holderParams).toString()
      const raw = await get(`/tokens/${token}/holders?${query}`)
      for (const item of raw.items ?? []) {
        const address = typeof item.address === 'string' ? item.address : item.address?.hash
        if (address && item.value !== undefined) holders.push({ address, value: item.value })
      }
      if (!raw.next_page_params || Object.keys(raw.next_page_params).length === 0) {
        holdersComplete = true
        break
      }
      holderParams = raw.next_page_params
    }
  } catch (error) {
    console.warn(`Holder ranking unavailable: ${error instanceof Error ? error.message : 'request failed'}`)
  }
  snapshot.holders = holders
  snapshot.holdersComplete = holdersComplete

  try {
    // The transfer/holder pagination above already spent a burst of requests
    // against the Robinhood Chain edge (observed to rate-limit the RPC host
    // too, HTTP 429, even though it's a different hostname — same edge/WAF
    // budget). A short pause here lets that window clear before the swap
    // indexer's own RPC calls start, instead of starting them already rate-limited.
    await new Promise((resolve) => setTimeout(resolve, 3000))
    snapshot.swaps = await indexPoolSwaps(priorSnapshot, now)
  } catch (error) {
    console.warn(`Swap indexing unavailable: ${error instanceof Error ? error.message : 'request failed'}`)
    snapshot.swaps = priorSnapshot?.swaps ?? null
  }

  await mkdir('public/data', { recursive: true })
  await writeFile('public/data/snapshot.json', `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(`Wrote ${transfers.length} verified transfers at ${snapshot.generatedAt}`)
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isDirectRun) {
  await main()
}
