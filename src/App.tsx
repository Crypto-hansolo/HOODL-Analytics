import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { CHAIN, CONFIGURED_POOL, HOODL_TOKEN, SNAPSHOT_STALE_AFTER_MS, STALE_AFTER_MS } from './config'
import { erc20BalanceOf, erc20Decimals, erc20Name, erc20Symbol, erc20TotalSupply } from './lib/erc20'
import { ethBlockNumber, ethChainId, ethGetCode, RpcError } from './lib/rpc'
import { formatCompactUnits, formatInteger, formatTimeAgo, formatUnits, isValidAddress, truncateAddress } from './lib/format'
import { computeSpotQuote, fetchPoolV3Data } from './lib/uniswapV3'
import { getTokenHolders, getTokenInfo, getTokenTransfers } from './lib/blockscout'
import type { PoolSpotQuote, PoolV3Data, PoolV3Field } from './lib/uniswapV3'
import { RANGE_KEYS, selectRange } from './lib/historyRange'
import type { ActivityCounts, HistoryDay, RangeKey } from './lib/historyRange'
import { ErrorBoundary } from './components/ErrorBoundary'
import { getRecentPoolSwaps } from './lib/poolSwaps'
import type { PoolSwap } from './lib/poolSwaps'
import { classifySwapDirection } from './lib/poolSwapDirection'
import { mergeIndexedState } from './lib/mergeIndexedState'
import type { IndexedState, Snapshot } from './lib/mergeIndexedState'

type Tab = 'Overview' | 'Trading' | 'Fees & Rewards' | 'Pools' | 'Holders'
type ChainState = { chainId: number | null; block: bigint | null; deployed: boolean | null; error: string | null }
type TokenState = { name: string | null; symbol: string | null; decimals: number | null; supply: bigint | null; error: string | null }

async function getSnapshot(): Promise<Snapshot> {
  // The snapshot is polled on the same 30s loop as live RPC/Blockscout
  // reads; a cached response would silently show a stale generatedAt as
  // freshly checked instead of correctly flagging it stale.
  const response = await fetch(`${import.meta.env.BASE_URL}data/snapshot.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`)
  return response.json() as Promise<Snapshot>
}

const tabs: Tab[] = ['Overview', 'Trading', 'Fees & Rewards', 'Pools', 'Holders']
const unavailable = 'Awaiting verified on-chain indexing'

function Badge({ children, tone = 'muted' }: { children: string; tone?: 'live' | 'calc' | 'muted' | 'warn' }) {
  return <span className={`badge ${tone}`}><i />{children}</span>
}

type DotTone = 'green' | 'yellow' | 'red' | 'gray'

function Dot({ tone }: { tone: DotTone }) {
  return <i className={`dot ${tone}`} />
}

function sourceLabel(source: 'live' | 'snapshot' | 'unavailable'): string {
  return source === 'live' ? 'live' : source === 'snapshot' ? 'snapshot fallback' : 'unavailable'
}

type MetricSource = 'On-chain' | 'Indexed' | 'Calculated' | 'Unavailable'

function Metric({ label, value, source = 'Unavailable', accent = false, error }: { label: string; value: string; source?: MetricSource; accent?: boolean; error?: string | null }) {
  const isUnavailable = source === 'Unavailable'
  const subtext = isUnavailable ? error ?? unavailable : 'Read from Robinhood Chain'
  const tone = source === 'On-chain' ? 'live' : source === 'Calculated' ? 'calc' : source === 'Unavailable' ? 'muted' : 'live'
  return <article className="metric" title={isUnavailable && error ? error : undefined}><div className="metric-top"><span>{label}</span><Badge tone={tone}>{source}</Badge></div><strong className={accent ? 'accent' : ''}>{value}</strong><small>{subtext}</small></article>
}

function LoadingBanner({ loading, updated }: { loading: boolean; updated: number }) {
  if (!loading && updated !== 0) return null
  return <div className="loading-banner" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" />{updated === 0 ? 'Connecting to Robinhood Chain and verified indexers…' : 'Refreshing live data…'}<small>Only confirmed values are shown; unavailable fields remain blank.</small></div>
}

function EmptyState({ title, body, todo }: { title: string; body: string; todo: string }) {
  return <div className="empty"><div className="empty-icon">◌</div><h3>{title}</h3><p>{body}</p><small><b>TODO</b> {todo}</small></div>
}

function formatFeeTier(fee: number): string {
  return `${(fee / 10_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}% (${formatInteger(fee)})`
}

function formatSpotQuote(quote: PoolSpotQuote | null): string {
  if (!quote || quote.status !== 'on-chain' || quote.wethPerHoodl === null || !Number.isFinite(quote.wethPerHoodl)) return '—'
  return quote.wethPerHoodl.toLocaleString('en-US', { maximumSignificantDigits: 8 })
}

function swapVolume(swaps: PoolSwap[], pool: PoolV3Data | null, decimals: number | null): string {
  const token0 = pool?.token0.value?.toLowerCase()
  const token1 = pool?.token1.value?.toLowerCase()
  const hoodlIs0 = token0 === HOODL_TOKEN.address.toLowerCase()
  if (!swaps.length || (!hoodlIs0 && token1 !== HOODL_TOKEN.address.toLowerCase()) || decimals === null) return '—'
  const total = swaps.reduce((sum, swap) => {
    const amount = hoodlIs0 ? swap.amount0 : swap.amount1
    return sum + (amount < 0n ? -amount : amount)
  }, 0n)
  return `${formatUnits(total, decimals)} HOODL`
}

function swapSideCounts(swaps: PoolSwap[], pool: PoolV3Data | null): { buy: number; sell: number } | null {
  const hoodlAddress = HOODL_TOKEN.address.toLowerCase()
  const token0 = pool?.token0.value?.toLowerCase()
  const token1 = pool?.token1.value?.toLowerCase()
  if (!swaps.length || (token0 !== hoodlAddress && token1 !== hoodlAddress)) return null
  const hoodlIsToken0 = token0 === hoodlAddress
  return swaps.reduce((counts, swap) => {
    const side = classifySwapDirection({ amount0: swap.amount0, amount1: swap.amount1, hoodlIsToken0 }).side
    counts[side] += 1
    return counts
  }, { buy: 0, sell: 0 })
}

function PoolV3Metric<T>({ label, field, render }: { label: string; field: PoolV3Field<T>; render: (value: T) => string }) {
  const value = field.status === 'on-chain' && field.value !== null ? render(field.value) : '—'
  return <Metric label={label} value={value} source={field.status === 'on-chain' ? 'On-chain' : 'Unavailable'} error={field.status === 'on-chain' ? null : field.error} />
}

function PoolV3AddressRow({ label, field }: { label: string; field: PoolV3Field<string> }) {
  const available = field.status === 'on-chain' && field.value !== null
  return (
    <div className="address-row">
      <span>
        <label>{label}</label>
        <code>{available ? field.value : 'Unavailable — RPC call did not return a value'}</code>
      </span>
      {available ? (
        <a href={`${CHAIN.explorerUrl}/address/${field.value}`} target="_blank" rel="noreferrer" aria-label={`View ${label} address on explorer`}>↗</a>
      ) : (
        <Badge tone="muted">Unavailable</Badge>
      )}
    </div>
  )
}

function Chart({ title, subtitle, activity, coverageComplete7d = false, history = [] }: { title: string; subtitle: string; activity?: ActivityCounts | null; coverageComplete7d?: boolean; history?: HistoryDay[] }) {
  const [range, setRange] = useState<RangeKey>('24H')
  const selection = selectRange(range, { activity: activity ?? null, coverageComplete7d, history })
  const isActivityRange = range === '1H' || range === '24H' || range === '7D'
  const verifiedCounts = activity ? [activity.transfers1h, activity.transfers24h, activity.transfers7d] : []
  const activityMax = Math.max(...verifiedCounts, 1)
  const dayCoverageTotal = selection.days.length + selection.gapDays
  const dayCoveragePct = dayCoverageTotal > 0 ? Math.round((selection.days.length / dayCoverageTotal) * 100) : 0
  const barWidth = !selection.available ? 0 : isActivityRange ? Math.max(6, Math.round(((selection.count ?? 0) / activityMax) * 100)) : Math.max(6, dayCoveragePct)
  const barCaption = isActivityRange ? `${barWidth}%` : `${dayCoveragePct}% day coverage`
  const detail = isActivityRange
    ? `Relative to the largest verified range in this snapshot (${activityMax} transfers). This is not a pool swap or volume series.`
    : `Sum of ${selection.days.length} verified closed UTC day${selection.days.length === 1 ? '' : 's'}${selection.gapDays ? ` · ${selection.gapDays} day${selection.gapDays === 1 ? '' : 's'} without verified data are shown as a gap, not zero` : ''}. This is not a pool swap or volume series.`
  return <section className="panel chart-panel"><div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div><div className="range" aria-label="Historical time range">{RANGE_KEYS.map((item) => <button key={item} className={range === item ? 'selected' : ''} aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}</div></div><div className={selection.available ? 'chart-value' : 'chart-empty'}>{selection.available ? <div className="chart-reading"><div className="chart-reading-head"><span>{selection.count} verified token transfers · {range}</span><strong>{barCaption}</strong></div><div className="activity-track" role="img" aria-label={`${selection.count} verified token transfers in the ${range} range`}><span style={{ width: `${barWidth}%` }} /></div><small>{detail}</small></div> : <div><span>Historical series unavailable · {range}</span><small>{selection.reason}</small></div>}</div></section>
}

function StatusRow({ tone, label, value, title }: { tone: DotTone; label: string; value: string; title?: string }) {
  return <div className="status-row" title={title}><span><Dot tone={tone} />{label}</span><b>{value}</b></div>
}

function DataIntegrityPanel({ token, chain, indexed }: { token: TokenState; chain: ChainState; indexed: IndexedState }) {
  const networkTone: DotTone = chain.error ? 'red' : chain.chainId === CHAIN.id ? 'green' : chain.chainId === null ? 'gray' : 'yellow'
  const networkValue = chain.error ? 'Unavailable' : chain.chainId === CHAIN.id ? 'Confirmed' : chain.chainId === null ? 'Pending' : 'Wrong network'
  const transfersTone: DotTone = !indexed.transfers.length ? 'gray' : indexed.transfersSource === 'live' ? 'green' : 'yellow'
  const transfersValue = indexed.transfers.length ? `${formatInteger(indexed.transfers.length)} events · ${sourceLabel(indexed.transfersSource)}` : 'Unavailable'
  const holdersTone: DotTone = !indexed.holderRows.length ? 'gray' : indexed.holdersSource === 'live' ? 'green' : 'yellow'
  const holdersValue = indexed.holderRows.length ? `${formatInteger(indexed.holderRows.length)} rows · ${sourceLabel(indexed.holdersSource)}` : 'Unavailable'
  const coverage = indexed.coverage
  const coverageTone: DotTone = !coverage ? 'gray' : coverage.coverageComplete7d ? 'green' : 'yellow'
  const coverageValue = !coverage ? 'Unavailable' : coverage.coverageComplete7d ? '7-day window confirmed' : `Partial · ${coverage.pagesFetched ?? '—'}/${coverage.maxPages ?? '—'} pages`
  const snapshotTone: DotTone = !indexed.snapshotAt ? 'gray' : indexed.snapshotStale ? 'yellow' : 'green'
  const snapshotValue = indexed.snapshotAt ? `${formatTimeAgo(new Date(indexed.snapshotAt).getTime())}${indexed.snapshotStale ? ' · stale' : ''}` : 'No snapshot yet'
  const snapshotTitle = indexed.snapshotAt ? `Snapshot generated ${new Date(indexed.snapshotAt).toLocaleString()}` : undefined
  return (
    <section className="panel status-panel">
      <div className="panel-head"><div><h2>Data integrity</h2><p>What is verified right now</p></div><Badge tone={indexed.snapshotStale ? 'warn' : 'live'}>{indexed.snapshotStale ? 'STALE SNAPSHOT' : 'TRANSPARENT'}</Badge></div>
      <StatusRow tone={token.error ? 'red' : 'green'} label="Token contract" value={token.error ? 'Unavailable' : 'Configured'} />
      <StatusRow tone={networkTone} label="Network identity" value={networkValue} />
      <StatusRow tone={transfersTone} label="Transfer activity" value={transfersValue} />
      <StatusRow tone={holdersTone} label="Holder ranking" value={holdersValue} />
      <StatusRow tone={coverageTone} label="7-day coverage" value={coverageValue} />
      <StatusRow tone={snapshotTone} label="Snapshot freshness" value={snapshotValue} title={snapshotTitle} />
      <StatusRow tone="gray" label="Fees / WETH rewards" value="Unavailable" />
      <div className="source-note">Sources: RPC for contract reads; Blockscout for indexed token metadata and transfers. Pool swaps, historical volume, rewards, and pool-derived economics remain unavailable until verified.{coverage && !coverage.coverageComplete7d ? ` Activity counts withheld because the snapshot reached only ${coverage.pagesFetched ?? 'a bounded number of'} page(s) and does not confirm 7-day coverage.` : ''}</div>
    </section>
  )
}

function Overview({ token, chain, indexed, updated }: { token: TokenState; chain: ChainState; indexed: IndexedState; updated: number }) {
  return <>
    <div className="hero-grid"><div className="hero-copy"><Badge tone="live">READ-ONLY TERMINAL</Badge><h1>Understand the<br /><em>HOODL economy.</em></h1><p>Track trading activity, liquidity, and WETH distributions on Robinhood Chain — with every metric sourced, timestamped, and honest.</p><div className="hero-links"><a href={`${CHAIN.explorerUrl}/token/${HOODL_TOKEN.address}`} target="_blank" rel="noreferrer">View token on Blockscout ↗</a><span>·</span><span>Chain {CHAIN.id}</span></div></div><div className="network-card"><div className="network-orbit"><span>H</span></div><div><span className="eyebrow">NETWORK STATUS</span><h3>{CHAIN.name}</h3><Badge tone={chain.error || (chain.chainId !== null && chain.chainId !== CHAIN.id) ? 'warn' : chain.chainId === CHAIN.id ? 'live' : 'muted'}>{chain.error ? 'RPC unavailable' : chain.chainId === null ? 'Awaiting RPC' : chain.chainId !== CHAIN.id ? 'Wrong network' : 'Read-only connected'}</Badge></div><div className="network-meta"><span>Chain ID <b>{chain.chainId ?? '—'}</b></span><span>Latest block <b>{chain.block ? formatInteger(Number(chain.block)) : '—'}</b></span></div></div></div>
    <div className="metrics"><Metric label="Token name" value={token.name ?? '—'} source={token.name ? 'On-chain' : 'Unavailable'} error={token.name ? null : token.error} accent /><Metric label="Symbol" value={token.symbol ?? '—'} source={token.symbol ? 'On-chain' : 'Unavailable'} error={token.symbol ? null : token.error} /><Metric label="Total supply" value={token.supply !== null && token.decimals !== null ? formatCompactUnits(token.supply, token.decimals) : '—'} source={token.supply !== null ? 'Calculated' : 'Unavailable'} error={token.supply !== null ? null : token.error} /><Metric label="Price (USD)" value={indexed.priceUsd ?? '—'} source={indexed.priceUsd ? 'Indexed' : 'Unavailable'} error={indexed.priceUsd ? null : indexed.error} /><Metric label="24h volume" value={indexed.volume24h ?? '—'} source={indexed.volume24h ? 'Indexed' : 'Unavailable'} error={indexed.volume24h ? null : indexed.error} /><Metric label="Holders" value={indexed.holders !== null ? formatInteger(indexed.holders) : '—'} source={indexed.holders !== null ? 'Indexed' : 'Unavailable'} error={indexed.holders !== null ? null : indexed.error} /></div>
    <div className="two-col"><Chart title="Transfer activity" subtitle={`Verified token transfers · paginated snapshot${indexed.snapshotStale ? ' · stale' : ''}`} activity={indexed.activity} coverageComplete7d={indexed.coverage?.coverageComplete7d} history={indexed.history} /><DataIntegrityPanel token={token} chain={chain} indexed={indexed} /></div>
    <div className="two-col"><section className="panel contract-panel"><div className="panel-head"><div><h2>Contracts</h2><p>Centralized, clickable configuration</p></div></div><div className="address-row"><span><label>HOODL TOKEN</label><code>{HOODL_TOKEN.address}</code></span><a href={`${CHAIN.explorerUrl}/address/${HOODL_TOKEN.address}`} target="_blank" rel="noreferrer" aria-label="View HOODL token address on explorer">↗</a></div><div className="address-row"><span><label>{CONFIGURED_POOL.poolType.toUpperCase()} POOL · {CONFIGURED_POOL.pair}</label><code>{CONFIGURED_POOL.address}</code></span><a href={`${CHAIN.explorerUrl}/address/${CONFIGURED_POOL.address}`} target="_blank" rel="noreferrer" aria-label={`View ${CONFIGURED_POOL.pair} pool address on explorer`}>↗</a></div></section><section className="panel block-panel"><div className="panel-head"><div><h2>On-chain snapshot</h2><p>Freshness is shown, never implied</p></div><Badge tone={chain.error ? 'warn' : 'live'}>{chain.error ? 'STALE' : 'LIVE'}</Badge></div><div className="snapshot"><span>Last updated <b>{updated ? new Date(updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</b></span><span>Contract deployed <b>{chain.deployed === null ? '—' : chain.deployed ? 'Yes' : 'No'}</b></span><span>Decimals <b>{token.decimals ?? '—'}</b></span></div></section></div>
  </>
}

function WalletLookup() {
  const [address, setAddress] = useState(''); const [result, setResult] = useState<string | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); setResult(null); if (!isValidAddress(address)) { setError('Enter a valid 20-byte wallet address.'); return } setBusy(true); try { const [balance, decimals] = await Promise.all([erc20BalanceOf(HOODL_TOKEN.address, address), erc20Decimals(HOODL_TOKEN.address)]); setResult(`${formatUnits(balance, decimals)} HOODL`) } catch (err) { setError(err instanceof RpcError ? err.message : 'RPC request failed or was blocked.') } finally { setBusy(false) } }
  return <section className="panel wallet"><div className="panel-head"><div><h2>Wallet lookup</h2><p>Public read-only balanceOf() query</p></div><Badge tone="live">ON-CHAIN</Badge></div><form onSubmit={submit}><input value={address} onChange={e => setAddress(e.target.value)} placeholder="0x wallet address" aria-label="Wallet address" spellCheck={false} /><button disabled={busy}>{busy ? 'Reading…' : 'Query balance ↗'}</button></form>{error && <p className="form-error" role="alert">{error}</p>}{result && <div className="wallet-result"><span>HOODL balance</span><b>{result}</b><code>{truncateAddress(address)}</code></div>}</section>
}

function PoolsTab({ poolV3, quote, swaps, decimals }: { poolV3: PoolV3Data | null; quote: PoolSpotQuote | null; swaps: PoolSwap[]; decimals: number | null }) {
  const anyOnChain = poolV3 ? Object.values(poolV3).some((f) => f.status === 'on-chain') : false
  const sideCounts = swapSideCounts(swaps, poolV3)
  return <>
    <section className="panel pool-card">
      <div>
        <Badge tone="live">{`${CONFIGURED_POOL.poolType.toUpperCase()} · ${CONFIGURED_POOL.pair}`}</Badge>
        <h2>Liquidity pool</h2>
        <code>{CONFIGURED_POOL.address}</code>
        <p>Configured {CONFIGURED_POOL.poolType} pool for the {CONFIGURED_POOL.pair} pair. Reserves, price, TVL, and fee/volume figures are only ever read live from the pool contract — nothing below is fabricated, and any field the RPC call fails to return is marked Unavailable.</p>
      </div>
      <a className="outline-btn" href={`${CHAIN.explorerUrl}/address/${CONFIGURED_POOL.address}`} target="_blank" rel="noreferrer">Open explorer ↗</a>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Pool technical details</h2><p>Read directly via eth_call against the Uniswap V3 pool interface</p></div><Badge tone={anyOnChain ? 'live' : 'warn'}>{anyOnChain ? 'ON-CHAIN' : 'RPC UNAVAILABLE'}</Badge></div>
      <div className="metrics" style={{ marginTop: 20 }}>
        <Metric label="Spot price · WETH / HOODL" value={formatSpotQuote(quote)} source={quote?.status === 'on-chain' ? 'Calculated' : 'Unavailable'} error={quote?.status === 'on-chain' ? null : quote?.error} accent />
        <PoolV3Metric label="Fee tier" field={poolV3?.fee ?? { status: 'unavailable', value: null, error: null }} render={formatFeeTier} />
        <PoolV3Metric label="Tick spacing" field={poolV3?.tickSpacing ?? { status: 'unavailable', value: null, error: null }} render={formatInteger} />
        <PoolV3Metric label="Liquidity" field={poolV3?.liquidity ?? { status: 'unavailable', value: null, error: null }} render={(v) => v.toLocaleString('en-US')} />
        <PoolV3Metric label="Current tick" field={poolV3 ? { status: poolV3.slot0.status, value: poolV3.slot0.value?.tick ?? null, error: poolV3.slot0.error } : { status: 'unavailable', value: null, error: null }} render={formatInteger} />
        <PoolV3Metric label="sqrtPriceX96" field={poolV3 ? { status: poolV3.slot0.status, value: poolV3.slot0.value?.sqrtPriceX96 ?? null, error: poolV3.slot0.error } : { status: 'unavailable', value: null, error: null }} render={(v) => v.toLocaleString('en-US')} />
        <PoolV3Metric label="Pool status" field={poolV3 ? { status: poolV3.slot0.status, value: poolV3.slot0.value?.unlocked ?? null, error: poolV3.slot0.error } : { status: 'unavailable', value: null, error: null }} render={(v) => (v ? 'Unlocked' : 'Locked')} />
      </div>
      <div style={{ marginTop: 4 }}>
        <PoolV3AddressRow label="TOKEN0" field={poolV3?.token0 ?? { status: 'unavailable', value: null, error: null }} />
        <PoolV3AddressRow label="TOKEN1" field={poolV3?.token1 ?? { status: 'unavailable', value: null, error: null }} />
      </div>
      <div className="source-note">token0/token1 order, fee tier, tick spacing, liquidity, and slot0 are read directly from the pool contract. Which token is WETH is not assumed here — verify via the addresses above. No price, TVL, volume, or reward figures are derived from these raw values.</div>
    </section>
    {swaps.length ? <section className="panel"><div className="panel-head"><div><h2>Verified swap activity</h2><p>Direct RPC logs · bounded 50,000-block window</p></div><Badge tone="live">INDEXED</Badge></div><div className="metrics" style={{ marginTop: 20 }}><Metric label="Swap events" value={formatInteger(swaps.length)} source="Indexed" /><Metric label="Buys" value={sideCounts ? formatInteger(sideCounts.buy) : '—'} source={sideCounts ? 'Calculated' : 'Unavailable'} /><Metric label="Sells" value={sideCounts ? formatInteger(sideCounts.sell) : '—'} source={sideCounts ? 'Calculated' : 'Unavailable'} /><Metric label="Unique senders" value={formatInteger(new Set(swaps.map((swap) => swap.sender.toLowerCase())).size)} source="Calculated" /><Metric label="HOODL volume" value={swapVolume(swaps, poolV3, decimals)} source={decimals !== null ? 'Calculated' : 'Unavailable'} error={decimals !== null ? null : 'Token decimals unavailable'} /></div><div className="source-note">Events are decoded from the configured pool's canonical Uniswap V3 Swap topic via eth_getLogs. This is a bounded event count, not lifetime volume; malformed logs are excluded.</div></section> : <EmptyState title="Pool price, TVL, volume, and rewards unavailable" body="No verified Swap events were returned by the direct RPC query. Nothing is inferred from transfers or raw pool state." todo="Retry the direct pool log query. Fees and rewards still require verified event semantics and a reward contract." />}
  </>
}

function HoldersTab({ indexed, token }: { indexed: IndexedState; token: TokenState }) {
  const rows = indexed.holderRows
  const topTen = rows.slice(0, 10)
  const topTenBalance = topTen.reduce((sum, row) => sum + BigInt(row.value), 0n)
  const concentration = token.supply && token.supply > 0n
    ? `${(Number(topTenBalance * 10_000n / token.supply) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
    : '—'
  return <>
    <div className="metrics"><Metric label="Current holders" value={indexed.holders !== null ? formatInteger(indexed.holders) : '—'} source={indexed.holders !== null ? 'Indexed' : 'Unavailable'} error={indexed.holders !== null ? null : indexed.error} /><Metric label="Ranking rows" value={rows.length ? formatInteger(rows.length) : '—'} source={rows.length ? 'Indexed' : 'Unavailable'} error={rows.length ? null : indexed.error} /><Metric label="Top 10 concentration" value={concentration} source={rows.length && token.supply ? 'Calculated' : 'Unavailable'} error={rows.length && token.supply ? null : !rows.length ? indexed.error : token.error} /><Metric label="WETH earned" value="—" /></div>
    <WalletLookup />
    {rows.length ? <section className="panel holder-table-panel"><div className="panel-head"><div><h2>Holder ranking</h2><p>Top {rows.length} rows returned by Blockscout · latest indexed state</p></div><Badge tone="live">INDEXED</Badge></div><div className="holder-table" role="table" aria-label="Holder ranking"><div className="holder-row holder-head" role="row"><span>Rank</span><span>Address</span><span>Balance</span><span>Share</span></div>{rows.map((row, index) => { const balance = BigInt(row.value); const share = token.supply && token.supply > 0n ? `${(Number(balance * 10_000n / token.supply) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` : '—'; return <div className="holder-row" role="row" key={row.address}><span>{index + 1}</span><a href={`${CHAIN.explorerUrl}/address/${row.address}`} target="_blank" rel="noreferrer">{truncateAddress(row.address)} ↗</a><span>{token.decimals !== null ? formatUnits(balance, token.decimals) : '—'} HOODL</span><span>{share}</span></div> })}</div><div className="source-note">Concentration is calculated from the first 10 rows returned by Blockscout divided by the on-chain total supply. It is not a claim about undisclosed holders or a complete historical distribution.</div></section> : <EmptyState title="Holder ranking unavailable" body="Blockscout did not return a verified holder dataset." todo="Retry the public holder endpoint or provide a repository snapshot before calculating ranking and concentration." />}
  </>
}

function TransferActivity({ transfers, decimals, stale, error }: { transfers: Awaited<ReturnType<typeof getTokenTransfers>>; decimals: number | null; stale: boolean; error: string | null }) {
  if (!transfers.length) {
    return <EmptyState title="Transfer activity unavailable" body={error ? `${error}. No live or snapshot transfer rows are available.` : 'No verified token transfer rows are available yet.'} todo="Retry the Blockscout endpoint or rerun the repository snapshot workflow." />
  }
  return <section className="panel transfer-panel"><div className="panel-head"><div><h2>Recent token transfers</h2><p>Verified HOODL ERC-20 transfers · {stale ? 'snapshot may be stale' : 'live endpoint or repository snapshot'}</p></div><Badge tone={stale ? 'warn' : 'live'}>{stale ? 'STALE' : 'INDEXED'}</Badge></div><div className="transfer-table" role="table" aria-label="Recent HOODL token transfers"><div className="transfer-row transfer-head" role="row"><span>Time</span><span>From → To</span><span>Amount</span><span>Block</span></div>{transfers.map((transfer, index) => <div className="transfer-row" role="row" key={`${transfer.hash}-${transfer.from}-${transfer.to}-${index}`}><span>{transfer.timestamp ? new Date(transfer.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span><span className="transfer-route"><a href={`${CHAIN.explorerUrl}/address/${transfer.from}`} target="_blank" rel="noreferrer">{truncateAddress(transfer.from)}</a><b>→</b><a href={`${CHAIN.explorerUrl}/address/${transfer.to}`} target="_blank" rel="noreferrer">{truncateAddress(transfer.to)}</a><a className="tx-link" href={`${CHAIN.explorerUrl}/tx/${transfer.hash}`} target="_blank" rel="noreferrer">tx ↗</a></span><span className="transfer-amount">{decimals !== null ? formatUnits(BigInt(transfer.value), decimals) : '—'} HOODL</span><span>{transfer.blockNumber !== null ? formatInteger(transfer.blockNumber) : '—'}</span></div>)}</div><div className="source-note">Rows are token transfers, not swaps. Amounts are formatted from the on-chain token units; no trading volume or fee value is inferred. Source failures are shown as unavailable rather than replaced with estimates.</div></section>
}

function TabContent({ tab, token, chain, poolV3, quote, swaps, indexed, updated }: { tab: Tab; token: TokenState; chain: ChainState; poolV3: PoolV3Data | null; quote: PoolSpotQuote | null; swaps: PoolSwap[]; indexed: IndexedState; updated: number }) {
  if (tab === 'Overview') return <Overview token={token} chain={chain} indexed={indexed} updated={updated} />
  if (tab === 'Holders') return <HoldersTab indexed={indexed} token={token} />
  if (tab === 'Pools') return <PoolsTab poolV3={poolV3} quote={quote} swaps={swaps} decimals={token.decimals} />
  if (tab === 'Trading') {
    const swapActivity = indexed.swapActivity
    return <>
      <div className="metrics"><Metric label="Swap events" value={swaps.length ? formatInteger(swaps.length) : '—'} source={swaps.length ? 'Indexed' : 'Unavailable'} error={swaps.length ? null : 'Direct pool log query returned no verified events'} /><Metric label="Verified transfers" value={indexed.transfers.length ? formatInteger(indexed.transfers.length) : '—'} source={indexed.transfers.length ? 'Indexed' : 'Unavailable'} error={indexed.transfers.length ? null : indexed.error} /><Metric label="HOODL volume" value={swapVolume(swaps, poolV3, token.decimals)} source={swaps.length && token.decimals !== null ? 'Calculated' : 'Unavailable'} error={swaps.length && token.decimals !== null ? null : 'Bounded pool swap volume unavailable'} /><Metric label="Unique traders" value={swaps.length ? formatInteger(new Set(swaps.map((swap) => swap.sender.toLowerCase())).size) : '—'} source={swaps.length ? 'Calculated' : 'Unavailable'} /></div>
      <div className="metrics" style={{ marginTop: 20 }}>
        <Metric label="24h volume (indexed)" value={swapActivity && token.decimals !== null ? `${formatUnits(BigInt(swapActivity.volume24hHoodl), token.decimals)} HOODL` : '—'} source={swapActivity ? 'Indexed' : 'Unavailable'} error={swapActivity ? null : 'Verified swap snapshot unavailable'} accent />
        <Metric label="24h buys / sells" value={swapActivity ? `${formatInteger(swapActivity.buyCount24h)} / ${formatInteger(swapActivity.sellCount24h)}` : '—'} source={swapActivity ? 'Indexed' : 'Unavailable'} error={swapActivity ? null : 'Verified swap snapshot unavailable'} />
        <Metric label="24h unique traders" value={swapActivity ? formatInteger(swapActivity.uniqueTraders24h) : '—'} source={swapActivity ? 'Indexed' : 'Unavailable'} error={swapActivity ? null : 'Verified swap snapshot unavailable'} />
      </div>
      <div className="source-note">24h volume, buy/sell, and trader figures come from a persisted, chunked eth_getLogs index of this pool's full Swap-event history, refreshed every 15 minutes — not from the bounded live RPC window above. &quot;Trader&quot; means a unique Swap-event sender address, which is not always the same as a unique wallet.</div>
      <Chart title="Transfer activity" subtitle="Verified token transfers · bounded source coverage" activity={indexed.activity} coverageComplete7d={indexed.coverage?.coverageComplete7d} history={indexed.history} /><TransferActivity transfers={indexed.transfers} decimals={token.decimals} stale={indexed.transfersStale} error={indexed.error} />
    </>
  }
  const title = 'Fees & rewards'
  return <><div className="metrics"><Metric label="Total volume" value="—" /><Metric label="Generated fees" value="—" /><Metric label="WETH distributed" value="—" /><Metric label="Distribution efficiency" value="—" /></div><Chart title={title} subtitle="Historical values will appear after verified indexing" /><EmptyState title={`${title} data unavailable`} body="No unverified DEX, fee, reward, or volume values are displayed." todo="Connect a verified pool-event indexer and document the event semantics before enabling calculations." /></>
}

function App() {
  const [tab, setTab] = useState<Tab>('Overview'); const [token, setToken] = useState<TokenState>({ name: null, symbol: null, decimals: null, supply: null, error: null }); const [chain, setChain] = useState<ChainState>({ chainId: null, block: null, deployed: null, error: null }); const [poolV3, setPoolV3] = useState<PoolV3Data | null>(null); const [quote, setQuote] = useState<PoolSpotQuote | null>(null); const [swaps, setSwaps] = useState<PoolSwap[]>([]); const [indexed, setIndexed] = useState<IndexedState>({ holders: null, priceUsd: null, volume24h: null, transfers: [], activity: null, history: [], holderRows: [], snapshotAt: null, snapshotStale: false, transfersStale: false, transfersSource: 'unavailable', holdersSource: 'unavailable', coverage: null, error: null, swapActivity: null, swapsSource: 'unavailable', swapIndexing: null }); const [updated, setUpdated] = useState(0); const [now, setNow] = useState(0); const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  async function load() {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    let successfulSourceGroups = 0
    try {
      const [name, symbol, decimals, supply] = await Promise.all([erc20Name(HOODL_TOKEN.address), erc20Symbol(HOODL_TOKEN.address), erc20Decimals(HOODL_TOKEN.address), erc20TotalSupply(HOODL_TOKEN.address)])
      successfulSourceGroups += 1
      setToken({ name, symbol, decimals, supply, error: null })
    } catch (err) { setToken(v => ({ ...v, error: err instanceof Error ? err.message : 'RPC unavailable' })) }
    try {
      const [chainId, block, code] = await Promise.all([ethChainId(), ethBlockNumber(), ethGetCode(HOODL_TOKEN.address)])
      successfulSourceGroups += 1
      setChain({ chainId, block, deployed: code !== '0x', error: null })
    } catch (err) { setChain(v => ({ ...v, error: err instanceof Error ? err.message : 'RPC unavailable' })) }
    try {
      const results = await Promise.allSettled([getTokenInfo(HOODL_TOKEN.address), getTokenTransfers(HOODL_TOKEN.address, 50), getSnapshot(), getTokenHolders(HOODL_TOKEN.address, 25)])
      const [infoResult, transfersResult, snapshotResult, holdersResult] = results
      const info = infoResult.status === 'fulfilled' ? infoResult.value : null
      const liveTransfers = transfersResult.status === 'fulfilled' ? transfersResult.value : []
      const snapshot = snapshotResult.status === 'fulfilled' ? snapshotResult.value : null
      const holderRows = holdersResult.status === 'fulfilled' ? holdersResult.value : []
      const failures = results.filter((result) => result.status === 'rejected')
      if (results.some((result) => result.status === 'fulfilled')) successfulSourceGroups += 1
      setIndexed(mergeIndexedState({ info, liveTransfers, snapshot, holderRows, failureCount: failures.length, now: Date.now(), snapshotStaleAfterMs: SNAPSHOT_STALE_AFTER_MS }))
    } catch (err) { setIndexed(v => ({ ...v, error: err instanceof Error ? err.message : 'Blockscout unavailable' })) }
    try {
      const [livePool, liveSwaps] = await Promise.all([fetchPoolV3Data(CONFIGURED_POOL.address), getRecentPoolSwaps()])
      successfulSourceGroups += 1
      setPoolV3(livePool)
      setSwaps(liveSwaps)
      const token0 = livePool.token0.value; const token1 = livePool.token1.value; const slot0 = livePool.slot0.value
      if (livePool.token0.status !== 'on-chain' || livePool.token1.status !== 'on-chain' || livePool.slot0.status !== 'on-chain' || !token0 || !token1 || !slot0) throw new Error('Pool identity or slot0 unavailable')
      const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([erc20Symbol(token0), erc20Symbol(token1), erc20Decimals(token0), erc20Decimals(token1)])
      setQuote(computeSpotQuote({ poolV3: livePool, hoodlAddress: HOODL_TOKEN.address, symbol0, symbol1, decimals0, decimals1 }))
    } catch (err) { setQuote({ status: 'unavailable', wethPerHoodl: null, token0Symbol: null, token1Symbol: null, error: err instanceof Error ? err.message : 'Pool quote unavailable' }) }
    setUpdated(successfulSourceGroups > 0 ? Date.now() : 0)
    setLoading(false)
    loadingRef.current = false
  }
  useEffect(() => { const kickoff = window.setTimeout(() => void load(), 0); const timer = window.setInterval(() => void load(), 30_000); const clock = window.setInterval(() => setNow(Date.now()), 1_000); return () => { window.clearTimeout(kickoff); window.clearInterval(timer); window.clearInterval(clock) } }, [])
  const stale = updated === 0 || now - updated > STALE_AFTER_MS
  const chainMatches = chain.chainId === CHAIN.id
  const connectionLabel = loading && updated === 0 ? 'Connecting…' : stale || chain.error || !chainMatches ? 'Check connection' : 'Live connection'
  return <div className="app-shell"><aside><div className="brand"><span className="brand-mark">H</span><span>HOODL <small>TERMINAL</small></span></div><div className="side-label">ANALYTICS</div><nav>{tabs.map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}><span className="nav-icon">{['◈', '⌁', '◌', '◇', '◎'][tabs.indexOf(item)]}</span>{item}</button>)}</nav><div className="side-bottom"><div className="connection"><i className={stale || chain.error || !chainMatches ? 'offline' : ''} />{connectionLabel}<small>Robinhood Chain · {CHAIN.id}</small></div><a href="https://github.com/Crypto-hansolo/HOODL-Analytics" target="_blank" rel="noreferrer">GitHub repository ↗</a></div></aside><main><header><div><span className="breadcrumb">HOODL / <b>{tab.toUpperCase()}</b></span><h2>{tab === 'Overview' ? 'Token intelligence, without the noise.' : tab}</h2></div><div className="header-actions"><Badge tone={chain.error || !chainMatches ? 'warn' : 'live'}>{loading && updated === 0 ? 'CONNECTING' : chain.error || !chainMatches ? 'CHECK RPC' : 'READ-ONLY'}</Badge><button className="refresh" disabled={loading} onClick={() => void load()} aria-label="Refresh live data">{loading ? '↻ Updating…' : '↻ Refresh'}</button></div></header><div className="content"><LoadingBanner loading={loading} updated={updated} /><ErrorBoundary key={tab}><TabContent tab={tab} token={token} chain={chain} poolV3={poolV3} quote={quote} swaps={swaps} indexed={indexed} updated={updated} /></ErrorBoundary></div><footer><span>HOODL ANALYTICS · DATA INTEGRITY FIRST</span><span>Last refresh {updated ? new Date(updated).toLocaleTimeString() : 'pending'}</span></footer></main></div>
}

export default App
