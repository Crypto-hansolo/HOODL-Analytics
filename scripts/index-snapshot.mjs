import { mkdir, writeFile } from 'node:fs/promises'

const token = '0x9fb3c2D71424122a5886DaC627177385d185DF09'
const pool = '0xF87761231646DA4aa00905c237EaCbfF112Df930'
const api = 'https://robinhoodchain.blockscout.com/api/v2'
const now = new Date()

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
const snapshot = {
  schemaVersion: 2,
  generatedAt: now.toISOString(),
  source: { name: 'Blockscout API v2', url: `${api}/tokens/${token}/transfers`, chainId: 4663, token, pool },
  coverage: { kind: 'recent-token-transfers', pagesFetched, maxPages: MAX_PAGES, coverageComplete7d, oldestTransferAt, note: coverageComplete7d ? 'Transfer activity is complete through the last 7 days at snapshot time. Pool swaps, fees, rewards, and holder ranking are not inferred from transfers.' : `Only a bounded prefix of the transfer index was returned${transferIndexError ? `; pagination stopped after an indexer error (${transferIndexError})` : ''}. Activity counts are lower bounds. Pool swaps, fees, rewards, and holder ranking are not inferred from transfers.` },
  transfers,
  activity: { transfers1h: counts(1), transfers24h: counts(24), transfers7d: counts(24 * 7) },
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
