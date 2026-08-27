// Pure range-selection logic for the transfer-activity chart. Nothing here
// performs I/O or reads the clock — every decision is a function of the
// verified snapshot data passed in, so a range is only ever "available"
// when real data backs it, and a missing calendar day is reported as a gap
// rather than silently filled in as zero.

export type RangeKey = '1H' | '24H' | '7D' | '30D' | '90D' | 'ALL'

export const RANGE_KEYS: readonly RangeKey[] = ['1H', '24H', '7D', '30D', '90D', 'ALL']

export interface HistoryDay {
  /** UTC calendar day, e.g. "2026-08-27". Only ever a fully-closed day. */
  date: string
  transferCount: number
}

export interface ActivityCounts {
  transfers1h: number
  transfers24h: number
  transfers7d: number
}

export interface RangeSelectionInput {
  activity: ActivityCounts | null
  coverageComplete7d: boolean
  history: HistoryDay[]
}

export interface RangeSelection {
  range: RangeKey
  available: boolean
  /** Verified transfer count for the range, or null when unavailable. */
  count: number | null
  /** The real, closed-day rows backing this range (day-bucketed ranges only). */
  days: HistoryDay[]
  /** Total closed days currently in history, regardless of this range's window. */
  closedDayCount: number
  /** Calendar days within this range's span that have no verified entry — a gap, never fabricated as zero. */
  gapDays: number
  /** Human-readable explanation when unavailable, otherwise null. */
  reason: string | null
}

const DAY_REQUIREMENT: Partial<Record<RangeKey, number>> = { '30D': 30, '90D': 90 }

function sumTransfers(days: HistoryDay[]): number {
  return days.reduce((sum, day) => sum + day.transferCount, 0)
}

function countGapDays(days: HistoryDay[]): number {
  if (days.length < 2) return 0
  const first = Date.parse(`${days[0].date}T00:00:00Z`)
  const last = Date.parse(`${days[days.length - 1].date}T00:00:00Z`)
  const spanDays = Math.round((last - first) / 86_400_000) + 1
  return Math.max(0, spanDays - days.length)
}

function activityRange(range: '1H' | '24H' | '7D', input: RangeSelectionInput): RangeSelection {
  const { activity, coverageComplete7d } = input
  if (!coverageComplete7d || !activity) {
    return {
      range,
      available: false,
      count: null,
      days: [],
      closedDayCount: input.history.length,
      gapDays: 0,
      reason: 'Snapshot coverage did not reach the 7-day boundary; counts are withheld rather than shown as incomplete.',
    }
  }
  const count = range === '1H' ? activity.transfers1h : range === '24H' ? activity.transfers24h : activity.transfers7d
  return { range, available: true, count, days: [], closedDayCount: input.history.length, gapDays: 0, reason: null }
}

function allRange(input: RangeSelectionInput): RangeSelection {
  const { history } = input
  if (history.length < 1) {
    return {
      range: 'ALL',
      available: false,
      count: null,
      days: [],
      closedDayCount: 0,
      gapDays: 0,
      reason: 'No verified closed day of transfer history is available yet.',
    }
  }
  return { range: 'ALL', available: true, count: sumTransfers(history), days: history, closedDayCount: history.length, gapDays: countGapDays(history), reason: null }
}

function thresholdRange(range: '30D' | '90D', input: RangeSelectionInput): RangeSelection {
  const { history } = input
  const required = DAY_REQUIREMENT[range]!
  if (history.length < required) {
    return {
      range,
      available: false,
      count: null,
      days: [],
      closedDayCount: history.length,
      gapDays: 0,
      reason: `Only ${history.length} verified closed day${history.length === 1 ? '' : 's'} of history ${history.length === 1 ? 'is' : 'are'} available; ${required} are required for ${range}.`,
    }
  }
  const windowDays = history.slice(-required)
  return { range, available: true, count: sumTransfers(windowDays), days: windowDays, closedDayCount: history.length, gapDays: countGapDays(windowDays), reason: null }
}

export function selectRange(range: RangeKey, input: RangeSelectionInput): RangeSelection {
  if (range === '1H' || range === '24H' || range === '7D') return activityRange(range, input)
  if (range === 'ALL') return allRange(input)
  return thresholdRange(range, input)
}
