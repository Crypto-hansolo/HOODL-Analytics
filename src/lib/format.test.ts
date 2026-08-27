import { describe, expect, it } from 'vitest'
import {
  formatCompactNumber,
  formatCompactUnits,
  formatInteger,
  formatTimeAgo,
  formatUnits,
  isValidAddress,
  truncateAddress,
} from './format'

describe('formatUnits', () => {
  it('formats whole and fractional token amounts with grouping', () => {
    expect(formatUnits(1_234_500_000_000_000_000_000n, 18)).toBe('1,234.5')
  })

  it('drops trailing zero fraction digits entirely', () => {
    expect(formatUnits(2_000_000_000_000_000_000n, 18)).toBe('2')
  })

  it('truncates the fraction to maxFractionDigits without rounding', () => {
    expect(formatUnits(1_999_999_999_999_999_999n, 18, 2)).toBe('1.99')
  })

  it('renders negative values with a leading minus sign', () => {
    expect(formatUnits(-1_500_000_000_000_000_000n, 18)).toBe('-1.5')
  })

  it('renders zero as a bare 0', () => {
    expect(formatUnits(0n, 18)).toBe('0')
  })
})

describe('formatCompactUnits', () => {
  it('compacts large token balances using the decimals scale', () => {
    expect(formatCompactUnits(1_500_000_000_000_000_000_000n, 18)).toBe('1.50K')
  })

  it('leaves small balances as a fixed 2-decimal number', () => {
    expect(formatCompactUnits(5_000_000_000_000_000_000n, 18)).toBe('5.00')
  })
})

describe('formatCompactNumber', () => {
  it.each([
    [999, '999.00'],
    [1_500, '1.50K'],
    [2_500_000, '2.50M'],
    [3_500_000_000, '3.50B'],
    [4_500_000_000_000, '4.50T'],
    [-2_500_000, '-2.50M'],
  ])('formats %d as %s', (input, expected) => {
    expect(formatCompactNumber(input)).toBe(expected)
  })
})

describe('truncateAddress', () => {
  const address = '0x1234567890abcdef1234567890abcdef12345678'

  it('shortens a full address to prefix…suffix', () => {
    expect(truncateAddress(address)).toBe('0x1234…5678')
  })

  it('honors a custom character count', () => {
    expect(truncateAddress(address, 6)).toBe('0x123456…345678')
  })

  it('returns short strings unchanged', () => {
    expect(truncateAddress('0xabc')).toBe('0xabc')
  })
})

describe('formatTimeAgo', () => {
  it('reports "just now" for sub-5-second deltas', () => {
    expect(formatTimeAgo(Date.now())).toBe('just now')
  })

  it('reports seconds ago under a minute', () => {
    expect(formatTimeAgo(Date.now() - 30_000)).toBe('30s ago')
  })

  it('reports minutes ago under an hour', () => {
    expect(formatTimeAgo(Date.now() - 5 * 60_000)).toBe('5m ago')
  })

  it('reports hours ago under a day', () => {
    expect(formatTimeAgo(Date.now() - 3 * 3_600_000)).toBe('3h ago')
  })

  it('reports days ago beyond 24 hours', () => {
    expect(formatTimeAgo(Date.now() - 2 * 86_400_000)).toBe('2d ago')
  })
})

describe('isValidAddress', () => {
  it('accepts a well-formed 20-byte hex address', () => {
    expect(isValidAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true)
  })

  it('accepts surrounding whitespace', () => {
    expect(isValidAddress('  0x1234567890abcdef1234567890abcdef12345678  ')).toBe(true)
  })

  it('rejects a value missing the 0x prefix', () => {
    expect(isValidAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false)
  })

  it('rejects a value with the wrong length', () => {
    expect(isValidAddress('0x1234')).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(isValidAddress('0x1234567890abcdef1234567890abcdef123456zz')).toBe(false)
  })
})

describe('formatInteger', () => {
  it('adds thousands separators', () => {
    expect(formatInteger(1_234_567)).toBe('1,234,567')
  })

  it('leaves small numbers unchanged', () => {
    expect(formatInteger(42)).toBe('42')
  })
})
