// Formatting helpers. Kept dependency-free and precision-safe (bigint math
// for token amounts instead of lossy float division of huge integers).

export function formatUnits(value: bigint, decimals: number, maxFractionDigits = 4): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const fraction = abs % base
  let fractionStr = fraction.toString().padStart(decimals, '0').slice(0, maxFractionDigits)
  fractionStr = fractionStr.replace(/0+$/, '')
  const wholeStr = whole.toLocaleString('en-US')
  const sign = negative ? '-' : ''
  return fractionStr ? `${sign}${wholeStr}.${fractionStr}` : `${sign}${wholeStr}`
}

export function formatCompactUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const remainder = value % base
  const asFloat = Number(whole) + Number(remainder) / Number(base)
  return formatCompactNumber(asFloat)
}

export function formatCompactNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 2) return address
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`
}

export function formatTimeAgo(timestampMs: number): string {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function isValidAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim())
}

export function formatInteger(n: number): string {
  return n.toLocaleString('en-US')
}
