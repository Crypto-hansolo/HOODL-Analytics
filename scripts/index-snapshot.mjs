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

const raw = await get(`/tokens/${token}/transfers`)
const transfers = (raw.items ?? []).flatMap((item) => {
  const hash = item.transaction_hash ?? item.tx_hash
  const from = item.from?.hash
  const to = item.to?.hash
  const value = item.total?.value
  if (!hash || !from || !to || value === undefined) return []
  return [{ hash, from, to, value, timestamp: item.timestamp ?? null, blockNumber: item.block_number ?? null }]
})
const dated = transfers.filter((row) => row.timestamp)
const counts = (hours) => dated.filter((row) => now.getTime() - new Date(row.timestamp).getTime() <= hours * 3600_000).length
const snapshot = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  source: { name: 'Blockscout API v2', url: `${api}/tokens/${token}/transfers`, chainId: 4663, token, pool },
  coverage: { kind: 'recent-token-transfers', note: 'This is a bounded source snapshot, not a complete historical index. Pool swaps, fees, rewards, and holder ranking are not inferred from transfers.' },
  transfers,
  activity: { transfers1h: counts(1), transfers24h: counts(24), transfers7d: counts(24 * 7) },
}
await mkdir('public/data', { recursive: true })
await writeFile('public/data/snapshot.json', `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`Wrote ${transfers.length} verified transfers at ${snapshot.generatedAt}`)
