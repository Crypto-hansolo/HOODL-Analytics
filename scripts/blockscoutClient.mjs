// Thin fetch wrapper for the Blockscout REST API used by the snapshot
// indexer. Root cause of "No transfer snapshot written: Blockscout HTTP 403"
// (observed running scripts/index-snapshot.mjs): Blockscout sits behind
// Cloudflare, which challenges (403 "Just a moment...") any request with no
// browser-like User-Agent header. Node's fetch() sends none by default. The
// deployed frontend (src/lib/blockscout.ts) is unaffected — real browsers
// always send a User-Agent — so only this Node-side script needs the header.
export const BLOCKSCOUT_USER_AGENT = 'Mozilla/5.0 (compatible; HOODL-Analytics-Indexer/1.0; +https://github.com/Crypto-hansolo/HOODL-Analytics)'

export async function blockscoutGet(apiBase, path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { accept: 'application/json', 'user-agent': BLOCKSCOUT_USER_AGENT },
  })
  if (!response.ok) throw new Error(`Blockscout HTTP ${response.status} for ${path}`)
  return response.json()
}
