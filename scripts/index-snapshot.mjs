import { mkdir, readFile, writeFile } from 'node:fs/promises'

const token = '0x9fb3c2D71424122a5886DaC627177385d185DF09'
const pool = '0xF87761231646DA4aa00905c237EaCbfF112Df930'
const api = 'https://robinhoodchain.blockscout.com/api/v2'
const now = new Date()
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
  const response = await fetch(`${api}${path}`, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Blockscout HTTP ${response.status} for ${path}`)
  return response.json()
}

const MAX_PAGES = 20
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
  schemaVersion: 3,
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
await mkdir('public/data', { recursive: true })
await writeFile('public/data/snapshot.json', `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`Wrote ${transfers.length} verified transfers at ${snapshot.generatedAt}`)
