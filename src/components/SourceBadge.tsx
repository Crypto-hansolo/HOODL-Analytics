import type { DataSource } from '../types'

type BadgeKind = DataSource | 'unverified' | 'unavailable' | 'stale' | 'live'

const LABEL: Record<BadgeKind, string> = {
  rpc: 'RPC',
  blockscout: 'Blockscout',
  unverified: 'Unverified',
  unavailable: 'Unavailable',
  stale: 'Stale',
  live: 'Live',
}

const TITLE: Record<BadgeKind, string> = {
  rpc: 'Read directly from the Robinhood Chain RPC endpoint via eth_call / eth_getLogs.',
  blockscout: 'Read from the Blockscout REST API (robinhoodchain.blockscout.com).',
  unverified: 'This value/mechanic has not been independently verified and is not fabricated.',
  unavailable: 'This data source did not respond successfully (network error, timeout, or CORS block).',
  stale: 'Showing the last successful value — a recent refresh attempt failed.',
  live: 'Actively polling for updates.',
}

export function SourceBadge({ kind }: { kind: BadgeKind }) {
  return (
    <span className={`badge badge--${kind}`} title={TITLE[kind]}>
      {LABEL[kind]}
    </span>
  )
}
