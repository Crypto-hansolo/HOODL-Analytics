// Pure merge logic for the "indexed" data panel (transfers, holders, price,
// activity/history). This is the one place that decides whether the UI shows
// live data or the repository snapshot fallback, and whether that fallback
// should be flagged stale — the core of this app's "truthful data" promise.
// Kept side-effect-free and unit-tested so a regression here (e.g. silently
// mislabeling stale snapshot data as live) fails a test, not just a user.

import type { ActivityCounts, HistoryDay } from './historyRange'
import type { BlockscoutHolder, BlockscoutTokenInfo, BlockscoutTransfer } from './blockscout'

export interface SnapshotCoverage {
  coverageComplete7d?: boolean
  pagesFetched?: number
  oldestTransferAt?: string | null
  note?: string
}

export interface Snapshot {
  generatedAt: string
  transfers: BlockscoutTransfer[]
  holders?: BlockscoutHolder[]
  holdersComplete?: boolean
  activity?: ActivityCounts
  history?: HistoryDay[]
  coverage?: SnapshotCoverage
}

export interface IndexedState {
  holders: number | null
  priceUsd: string | null
  volume24h: string | null
  transfers: BlockscoutTransfer[]
  activity: ActivityCounts | null
  history: HistoryDay[]
  holderRows: BlockscoutHolder[]
  snapshotAt: string | null
  snapshotStale: boolean
  transfersStale: boolean
  coverage: SnapshotCoverage | null
  error: string | null
}

export interface MergeIndexedStateInput {
  info: BlockscoutTokenInfo | null
  liveTransfers: BlockscoutTransfer[]
  snapshot: Snapshot | null
  holderRows: BlockscoutHolder[]
  failureCount: number
  now: number
  snapshotStaleAfterMs: number
}

export function mergeIndexedState(input: MergeIndexedStateInput): IndexedState {
  const { info, liveTransfers, snapshot, holderRows, failureCount, now, snapshotStaleAfterMs } = input
  const snapshotAt = snapshot?.generatedAt ?? null
  const snapshotStale = snapshotAt !== null && now - new Date(snapshotAt).getTime() > snapshotStaleAfterMs
  const usingLiveTransfers = liveTransfers.length > 0
  // Staleness describes the repository snapshot file, not live data — only apply it
  // to the transfer rows when those rows actually came from the snapshot fallback.
  const transfersStale = !usingLiveTransfers && snapshotStale
  const snapshotHolders = snapshot?.holders ?? []
  return {
    holders: info?.holdersCount ?? (snapshot?.holdersComplete && snapshotHolders.length ? snapshotHolders.length : null),
    priceUsd: info?.exchangeRateUsd ?? null,
    volume24h: info?.volume24h ?? null,
    transfers: usingLiveTransfers ? liveTransfers : snapshot?.transfers ?? [],
    activity: snapshot?.activity ?? null,
    history: snapshot?.history ?? [],
    holderRows: holderRows.length ? holderRows : snapshotHolders,
    snapshotAt,
    snapshotStale,
    transfersStale,
    coverage: snapshot?.coverage ?? null,
    error: failureCount ? `${failureCount} indexed source${failureCount === 1 ? '' : 's'} unavailable` : null,
  }
}
