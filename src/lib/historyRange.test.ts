import { describe, expect, it } from 'vitest'
import { selectRange } from './historyRange'
import type { HistoryDay } from './historyRange'

function days(dates: string[]): HistoryDay[] {
  return dates.map((date, i) => ({ date, transferCount: i + 1 }))
}

function consecutiveDays(count: number, startDate = '2026-01-01'): HistoryDay[] {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    transferCount: i,
  }))
}

const activity = { transfers1h: 3, transfers24h: 40, transfers7d: 200 }

describe('selectRange: 1H/24H/7D activity ranges', () => {
  it('is unavailable when coverage did not reach the 7-day boundary', () => {
    const result = selectRange('24H', { activity, coverageComplete7d: false, history: [] })
    expect(result.available).toBe(false)
    expect(result.count).toBeNull()
    expect(result.reason).not.toBeNull()
  })

  it('is unavailable when there is no activity snapshot at all', () => {
    const result = selectRange('1H', { activity: null, coverageComplete7d: true, history: [] })
    expect(result.available).toBe(false)
    expect(result.count).toBeNull()
  })

  it('returns the verified count for 1H when coverage is complete', () => {
    const result = selectRange('1H', { activity, coverageComplete7d: true, history: [] })
    expect(result).toMatchObject({ available: true, count: 3, reason: null })
  })

  it('returns the verified count for 24H when coverage is complete', () => {
    const result = selectRange('24H', { activity, coverageComplete7d: true, history: [] })
    expect(result).toMatchObject({ available: true, count: 40, reason: null })
  })

  it('returns the verified count for 7D when coverage is complete', () => {
    const result = selectRange('7D', { activity, coverageComplete7d: true, history: [] })
    expect(result).toMatchObject({ available: true, count: 200, reason: null })
  })
})

describe('selectRange: 30D/90D thresholds', () => {
  it('is unavailable with partial history below the 30-day threshold', () => {
    const result = selectRange('30D', { activity: null, coverageComplete7d: false, history: consecutiveDays(10) })
    expect(result.available).toBe(false)
    expect(result.closedDayCount).toBe(10)
    expect(result.reason).toContain('10')
  })

  it('is unavailable at exactly 29 closed days for 30D', () => {
    const result = selectRange('30D', { activity: null, coverageComplete7d: false, history: consecutiveDays(29) })
    expect(result.available).toBe(false)
  })

  it('becomes available at exactly 30 closed days for 30D', () => {
    const result = selectRange('30D', { activity: null, coverageComplete7d: false, history: consecutiveDays(30) })
    expect(result.available).toBe(true)
    expect(result.days).toHaveLength(30)
    expect(result.count).toBe(consecutiveDays(30).reduce((sum, d) => sum + d.transferCount, 0))
  })

  it('is unavailable at exactly 89 closed days for 90D', () => {
    const result = selectRange('90D', { activity: null, coverageComplete7d: false, history: consecutiveDays(89) })
    expect(result.available).toBe(false)
  })

  it('becomes available at exactly 90 closed days for 90D', () => {
    const result = selectRange('90D', { activity: null, coverageComplete7d: false, history: consecutiveDays(90) })
    expect(result.available).toBe(true)
    expect(result.days).toHaveLength(90)
  })

  it('uses only the most recent required window when history exceeds the requirement', () => {
    const history = consecutiveDays(120)
    const result = selectRange('30D', { activity: null, coverageComplete7d: false, history })
    expect(result.days).toHaveLength(30)
    expect(result.days[0].date).toBe(history[90].date)
    expect(result.days[29].date).toBe(history[119].date)
  })
})

describe('selectRange: gaps are reported, never fabricated', () => {
  it('reports zero gap days for a fully consecutive window', () => {
    const result = selectRange('ALL', { activity: null, coverageComplete7d: false, history: consecutiveDays(5) })
    expect(result.gapDays).toBe(0)
  })

  it('reports missing calendar days as gapDays without inventing entries for them', () => {
    // 2026-01-01, 01-02, then a jump to 01-10: 7 missing calendar days in between.
    const history = [
      { date: '2026-01-01', transferCount: 4 },
      { date: '2026-01-02', transferCount: 2 },
      { date: '2026-01-10', transferCount: 9 },
    ]
    const result = selectRange('ALL', { activity: null, coverageComplete7d: false, history })
    expect(result.days).toHaveLength(3)
    expect(result.gapDays).toBe(7)
    expect(result.count).toBe(15)
  })
})

describe('selectRange: empty history', () => {
  it('makes ALL unavailable when there is no closed day yet', () => {
    const result = selectRange('ALL', { activity: null, coverageComplete7d: false, history: [] })
    expect(result.available).toBe(false)
    expect(result.count).toBeNull()
    expect(result.closedDayCount).toBe(0)
    expect(result.reason).not.toBeNull()
  })

  it('makes 30D and 90D unavailable when there is no closed day yet', () => {
    expect(selectRange('30D', { activity: null, coverageComplete7d: false, history: [] }).available).toBe(false)
    expect(selectRange('90D', { activity: null, coverageComplete7d: false, history: [] }).available).toBe(false)
  })
})

describe('selectRange: ALL', () => {
  it('is available with a single verified closed day', () => {
    const result = selectRange('ALL', { activity: null, coverageComplete7d: false, history: days(['2026-01-01']) })
    expect(result.available).toBe(true)
    expect(result.closedDayCount).toBe(1)
    expect(result.count).toBe(1)
  })

  it('sums every closed day currently in history', () => {
    const history = consecutiveDays(45)
    const result = selectRange('ALL', { activity: null, coverageComplete7d: false, history })
    expect(result.days).toHaveLength(45)
    expect(result.count).toBe(history.reduce((sum, d) => sum + d.transferCount, 0))
  })
})
