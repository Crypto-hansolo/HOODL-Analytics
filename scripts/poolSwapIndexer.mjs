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
