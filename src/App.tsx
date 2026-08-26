import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { CHAIN, CONFIGURED_POOL, HOODL_TOKEN, STALE_AFTER_MS } from './config'
import { erc20BalanceOf, erc20Decimals, erc20Name, erc20Symbol, erc20TotalSupply } from './lib/erc20'
import { ethBlockNumber, ethChainId, ethGetCode, RpcError } from './lib/rpc'
import { formatCompactUnits, formatInteger, formatUnits, isValidAddress, truncateAddress } from './lib/format'
import { fetchPoolV3Data } from './lib/uniswapV3'
import { getTokenHolders, getTokenInfo, getTokenTransfers } from './lib/blockscout'
import type { PoolSpotQuote, PoolV3Data, PoolV3Field } from './lib/uniswapV3'
import type { BlockscoutHolder } from './lib/blockscout'

type Tab = 'Overview' | 'Trading' | 'Fees & Rewards' | 'Pools' | 'Holders'
type ChainState = { chainId: number | null; block: bigint | null; deployed: boolean | null; error: string | null }
type TokenState = { name: string | null; symbol: string | null; decimals: number | null; supply: bigint | null; error: string | null }
type IndexedState = { holders: number | null; priceUsd: string | null; volume24h: string | null; transfers: Awaited<ReturnType<typeof getTokenTransfers>>; holderRows: BlockscoutHolder[]; snapshotAt: string | null; error: string | null }

type Snapshot = { generatedAt: string; transfers: Awaited<ReturnType<typeof getTokenTransfers>> }

async function getSnapshot(): Promise<Snapshot> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/snapshot.json`)
  if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`)
  return response.json() as Promise<Snapshot>
}

const tabs: Tab[] = ['Overview', 'Trading', 'Fees & Rewards', 'Pools', 'Holders']
const unavailable = 'Awaiting verified on-chain indexing'

function Badge({ children, tone = 'muted' }: { children: string; tone?: 'live' | 'calc' | 'muted' | 'warn' }) {
  return <span className={`badge ${tone}`}><i />{children}</span>
}

function Metric({ label, value, source = 'Unavailable', accent = false }: { label: string; value: string; source?: string; accent?: boolean }) {
  return <article className="metric"><div className="metric-top"><span>{label}</span><Badge tone={source === 'On-chain' ? 'live' : source === 'Calculated' ? 'calc' : 'muted'}>{source}</Badge></div><strong className={accent ? 'accent' : ''}>{value}</strong><small>{source === 'Unavailable' ? unavailable : 'Read from Robinhood Chain'}</small></article>
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

function PoolV3Metric<T>({ label, field, render }: { label: string; field: PoolV3Field<T>; render: (value: T) => string }) {
  const value = field.status === 'on-chain' && field.value !== null ? render(field.value) : '—'
  return <Metric label={label} value={value} source={field.status === 'on-chain' ? 'On-chain' : 'Unavailable'} />
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
        <a href={`${CHAIN.explorerUrl}/address/${field.value}`} target="_blank" rel="noreferrer">↗</a>
      ) : (
        <Badge tone="muted">Unavailable</Badge>
      )}
    </div>
  )
}

function Chart({ title, subtitle }: { title: string; subtitle: string }) {
  const ranges = ['1H', '24H', '7D', '30D', '90D', 'ALL'] as const
  const [range, setRange] = useState<(typeof ranges)[number]>('24H')
  return <section className="panel chart-panel"><div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div><div className="range" aria-label="Historical time range">{ranges.map((item) => <button key={item} className={range === item ? 'selected' : ''} aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}</div></div><div className="chart-empty"><div><span>Historical series unavailable · {range}</span><small>No verified time-series snapshot is configured. Live contract reads are intentionally not presented as historical data.</small></div></div></section>
}

function Overview({ token, chain, indexed }: { token: TokenState; chain: ChainState; indexed: IndexedState }) {
  return <>
    <div className="hero-grid"><div className="hero-copy"><Badge tone="live">READ-ONLY TERMINAL</Badge><h1>Understand the<br /><em>HOODL economy.</em></h1><p>Track trading activity, liquidity, and WETH distributions on Robinhood Chain — with every metric sourced, timestamped, and honest.</p><div className="hero-links"><a href={`${CHAIN.explorerUrl}/token/${HOODL_TOKEN.address}`} target="_blank" rel="noreferrer">View token on Blockscout ↗</a><span>·</span><span>Chain {CHAIN.id}</span></div></div><div className="network-card"><div className="network-orbit"><span>H</span></div><div><span className="eyebrow">NETWORK STATUS</span><h3>{CHAIN.name}</h3><Badge tone={chain.error ? 'warn' : 'live'}>{chain.error ? 'RPC unavailable' : 'Read-only connected'}</Badge></div><div className="network-meta"><span>Chain ID <b>{chain.chainId ?? CHAIN.id}</b></span><span>Latest block <b>{chain.block ? formatInteger(Number(chain.block)) : '—'}</b></span></div></div></div>
    <div className="metrics"><Metric label="Token name" value={token.name ?? '—'} source={token.name ? 'On-chain' : 'Unavailable'} accent /><Metric label="Symbol" value={token.symbol ?? '—'} source={token.symbol ? 'On-chain' : 'Unavailable'} /><Metric label="Total supply" value={token.supply !== null && token.decimals !== null ? formatCompactUnits(token.supply, token.decimals) : '—'} source={token.supply !== null ? 'Calculated' : 'Unavailable'} /><Metric label="Price (USD)" value={indexed.priceUsd ?? '—'} source={indexed.priceUsd ? 'Blockscout' : 'Unavailable'} /><Metric label="24h volume" value={indexed.volume24h ?? '—'} source={indexed.volume24h ? 'Blockscout' : 'Unavailable'} /><Metric label="Holders" value={indexed.holders !== null ? formatInteger(indexed.holders) : '—'} source={indexed.holders !== null ? 'Blockscout' : 'Unavailable'} /></div>
    <div className="two-col"><Chart title="Trading activity" subtitle="Historical ranges · indexed snapshots only" /><section className="panel status-panel"><div className="panel-head"><div><h2>Data integrity</h2><p>What is verified right now</p></div><Badge tone="live">TRANSPARENT</Badge></div><div className="status-row"><span><i className="dot green" />Token contract</span><b>{token.error ? 'Unavailable' : 'Configured'}</b></div><div className="status-row"><span><i className="dot green" />Network identity</span><b>{chain.chainId === CHAIN.id ? 'Confirmed' : 'Pending'}</b></div><div className="status-row"><span><i className="dot green" />Transfer activity</span><b>{indexed.transfers.length ? `${indexed.transfers.length} recent events` : 'Unavailable'}</b></div><div className="status-row"><span><i className="dot gray" />Fees / WETH rewards</span><b>Unavailable</b></div><div className="source-note">Sources: RPC for contract reads; Blockscout for indexed token metadata and transfers. Historical series, rewards, and pool-derived economics remain unavailable until verified.{indexed.snapshotAt ? ` Snapshot generated ${new Date(indexed.snapshotAt).toLocaleString()}.` : ' Snapshot unavailable.'}</div></section></div>
    <div className="two-col"><section className="panel contract-panel"><div className="panel-head"><div><h2>Contracts</h2><p>Centralized, clickable configuration</p></div></div><div className="address-row"><span><label>HOODL TOKEN</label><code>{HOODL_TOKEN.address}</code></span><a href={`${CHAIN.explorerUrl}/address/${HOODL_TOKEN.address}`} target="_blank" rel="noreferrer">↗</a></div><div className="address-row"><span><label>{CONFIGURED_POOL.poolType.toUpperCase()} POOL · {CONFIGURED_POOL.pair}</label><code>{CONFIGURED_POOL.address}</code></span><a href={`${CHAIN.explorerUrl}/address/${CONFIGURED_POOL.address}`} target="_blank" rel="noreferrer">↗</a></div></section><section className="panel block-panel"><div className="panel-head"><div><h2>On-chain snapshot</h2><p>Freshness is shown, never implied</p></div><Badge tone={chain.error ? 'warn' : 'live'}>{chain.error ? 'STALE' : 'LIVE'}</Badge></div><div className="snapshot"><span>Last updated <b>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></span><span>Contract deployed <b>{chain.deployed === null ? '—' : chain.deployed ? 'Yes' : 'No'}</b></span><span>Decimals <b>{token.decimals ?? '—'}</b></span></div></section></div>
  </>
}

function WalletLookup() {
  const [address, setAddress] = useState(''); const [result, setResult] = useState<string | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); setResult(null); if (!isValidAddress(address)) { setError('Enter a valid 20-byte wallet address.'); return } setBusy(true); try { const [balance, decimals] = await Promise.all([erc20BalanceOf(HOODL_TOKEN.address, address), erc20Decimals(HOODL_TOKEN.address)]); setResult(`${formatUnits(balance, decimals)} HOODL`) } catch (err) { setError(err instanceof RpcError ? err.message : 'RPC request failed or was blocked.') } finally { setBusy(false) } }
  return <section className="panel wallet"><div className="panel-head"><div><h2>Wallet lookup</h2><p>Public read-only balanceOf() query</p></div><Badge tone="live">ON-CHAIN</Badge></div><form onSubmit={submit}><input value={address} onChange={e => setAddress(e.target.value)} placeholder="0x wallet address" spellCheck={false} /><button disabled={busy}>{busy ? 'Reading…' : 'Query balance ↗'}</button></form>{error && <p className="form-error">{error}</p>}{result && <div className="wallet-result"><span>HOODL balance</span><b>{result}</b><code>{truncateAddress(address)}</code></div>}</section>
}

function PoolsTab({ poolV3, quote }: { poolV3: PoolV3Data | null; quote: PoolSpotQuote | null }) {
  const anyOnChain = poolV3 ? Object.values(poolV3).some((f) => f.status === 'on-chain') : false
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
        <Metric label="Spot price · WETH / HOODL" value={formatSpotQuote(quote)} source={quote?.status === 'on-chain' ? 'Calculated' : 'Unavailable'} accent />
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
    <EmptyState title="Pool price, TVL, volume, and rewards unavailable" body="Computing price/TVL from sqrtPriceX96 requires confirmed decimals for both pool tokens, and volume/fees/rewards require an indexed event history. None of these are fabricated." todo="Confirm token1 decimals and connect a verified swap-event indexer to enable these calculations." />
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
    <div className="metrics"><Metric label="Current holders" value={indexed.holders !== null ? formatInteger(indexed.holders) : '—'} source={indexed.holders !== null ? 'Blockscout' : 'Unavailable'} /><Metric label="Ranking rows" value={rows.length ? formatInteger(rows.length) : '—'} source={rows.length ? 'Blockscout' : 'Unavailable'} /><Metric label="Top 10 concentration" value={concentration} source={rows.length && token.supply ? 'Calculated' : 'Unavailable'} /><Metric label="WETH earned" value="—" /></div>
    <WalletLookup />
    {rows.length ? <section className="panel holder-table-panel"><div className="panel-head"><div><h2>Holder ranking</h2><p>Top {rows.length} rows returned by Blockscout · latest indexed state</p></div><Badge tone="live">INDEXED</Badge></div><div className="holder-table" role="table" aria-label="Holder ranking"><div className="holder-row holder-head" role="row"><span>Rank</span><span>Address</span><span>Balance</span><span>Share</span></div>{rows.map((row, index) => { const balance = BigInt(row.value); const share = token.supply && token.supply > 0n ? `${(Number(balance * 10_000n / token.supply) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` : '—'; return <div className="holder-row" role="row" key={row.address}><span>{index + 1}</span><a href={`${CHAIN.explorerUrl}/address/${row.address}`} target="_blank" rel="noreferrer">{truncateAddress(row.address)} ↗</a><span>{token.decimals !== null ? formatUnits(balance, token.decimals) : '—'} HOODL</span><span>{share}</span></div> })}</div><div className="source-note">Concentration is calculated from the first 10 rows returned by Blockscout divided by the on-chain total supply. It is not a claim about undisclosed holders or a complete historical distribution.</div></section> : <EmptyState title="Holder ranking unavailable" body="Blockscout did not return a verified holder dataset." todo="Retry the public holder endpoint or provide a repository snapshot before calculating ranking and concentration." />}
  </>
}

function TabContent({ tab, token, chain, poolV3, quote, indexed }: { tab: Tab; token: TokenState; chain: ChainState; poolV3: PoolV3Data | null; quote: PoolSpotQuote | null; indexed: IndexedState }) {
  if (tab === 'Overview') return <Overview token={token} chain={chain} indexed={indexed} />
  if (tab === 'Holders') return <HoldersTab indexed={indexed} token={token} />
  if (tab === 'Pools') return <PoolsTab poolV3={poolV3} quote={quote} />
  const title = tab === 'Trading' ? 'Trading analytics' : 'Fees & rewards'
  return <><div className="metrics"><Metric label="Total volume" value="—" /><Metric label={tab === 'Trading' ? 'Buy / sell ratio' : 'Generated fees'} value="—" /><Metric label={tab === 'Trading' ? 'Unique traders' : 'WETH distributed'} value="—" /><Metric label={tab === 'Trading' ? 'Largest trade' : 'Distribution efficiency'} value="—" /></div><Chart title={title} subtitle="Historical values will appear after verified indexing" /><EmptyState title={`${title} data unavailable`} body="No unverified DEX, fee, reward, or volume values are displayed." todo="Connect a verified indexer and document the event semantics before enabling calculations." /></>
}

function App() {
  const [tab, setTab] = useState<Tab>('Overview'); const [token, setToken] = useState<TokenState>({ name: null, symbol: null, decimals: null, supply: null, error: null }); const [chain, setChain] = useState<ChainState>({ chainId: null, block: null, deployed: null, error: null }); const [poolV3, setPoolV3] = useState<PoolV3Data | null>(null); const [quote, setQuote] = useState<PoolSpotQuote | null>(null); const [indexed, setIndexed] = useState<IndexedState>({ holders: null, priceUsd: null, volume24h: null, transfers: [], holderRows: [], snapshotAt: null, error: null }); const [updated, setUpdated] = useState(Date.now()); const [loading, setLoading] = useState(false)
  async function load() {
    setLoading(true)
    try {
      const [name, symbol, decimals, supply] = await Promise.all([erc20Name(HOODL_TOKEN.address), erc20Symbol(HOODL_TOKEN.address), erc20Decimals(HOODL_TOKEN.address), erc20TotalSupply(HOODL_TOKEN.address)])
      setToken({ name, symbol, decimals, supply, error: null })
    } catch (err) { setToken(v => ({ ...v, error: err instanceof Error ? err.message : 'RPC unavailable' })) }
    try {
      const [chainId, block, code] = await Promise.all([ethChainId(), ethBlockNumber(), ethGetCode(HOODL_TOKEN.address)])
      setChain({ chainId, block, deployed: code !== '0x', error: null })
    } catch (err) { setChain(v => ({ ...v, error: err instanceof Error ? err.message : 'RPC unavailable' })) }
    try {
      const [info, transfers, snapshot, holderRows] = await Promise.all([getTokenInfo(HOODL_TOKEN.address), getTokenTransfers(HOODL_TOKEN.address, 50), getSnapshot(), getTokenHolders(HOODL_TOKEN.address, 25)])
      setIndexed({ holders: info.holdersCount, priceUsd: info.exchangeRateUsd, volume24h: info.volume24h, transfers: snapshot.transfers.length ? snapshot.transfers : transfers, holderRows, snapshotAt: snapshot.generatedAt, error: null })
    } catch (err) { setIndexed(v => ({ ...v, error: err instanceof Error ? err.message : 'Blockscout unavailable' })) }
    try {
      const livePool = await fetchPoolV3Data(CONFIGURED_POOL.address)
      setPoolV3(livePool)
      const token0 = livePool.token0.value; const token1 = livePool.token1.value; const slot0 = livePool.slot0.value
      if (livePool.token0.status !== 'on-chain' || livePool.token1.status !== 'on-chain' || livePool.slot0.status !== 'on-chain' || !token0 || !token1 || !slot0) throw new Error('Pool identity or slot0 unavailable')
      const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([erc20Symbol(token0), erc20Symbol(token1), erc20Decimals(token0), erc20Decimals(token1)])
      const isHoodl0 = token0.toLowerCase() === HOODL_TOKEN.address.toLowerCase() && symbol1?.toUpperCase() === 'WETH'
      const isHoodl1 = token1.toLowerCase() === HOODL_TOKEN.address.toLowerCase() && symbol0?.toUpperCase() === 'WETH'
      if ((!isHoodl0 && !isHoodl1) || !symbol0 || !symbol1 || slot0.sqrtPriceX96 === 0n) throw new Error('Pool is not verified as HOODL/WETH')
      const rawToken1PerToken0 = Number(slot0.sqrtPriceX96) ** 2 / 2 ** 192 * 10 ** (decimals0 - decimals1)
      const wethPerHoodl = isHoodl0 ? rawToken1PerToken0 : 1 / rawToken1PerToken0
      if (!Number.isFinite(wethPerHoodl)) throw new Error('Derived spot price is not finite')
      setQuote({ status: 'on-chain', wethPerHoodl, token0Symbol: symbol0, token1Symbol: symbol1, error: null })
    } catch (err) { setQuote({ status: 'unavailable', wethPerHoodl: null, token0Symbol: null, token1Symbol: null, error: err instanceof Error ? err.message : 'Pool quote unavailable' }) }
    setUpdated(Date.now()); setLoading(false)
  }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer) }, [])
  const stale = Date.now() - updated > STALE_AFTER_MS
  return <div className="app-shell"><aside><div className="brand"><span className="brand-mark">H</span><span>HOODL <small>TERMINAL</small></span></div><div className="side-label">ANALYTICS</div><nav>{tabs.map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}><span className="nav-icon">{['◈', '⌁', '◌', '◇', '◎'][tabs.indexOf(item)]}</span>{item}</button>)}</nav><div className="side-bottom"><div className="connection"><i className={stale || chain.error ? 'offline' : ''} />{stale || chain.error ? 'RPC unavailable' : 'Live connection'}<small>Robinhood Chain · {CHAIN.id}</small></div><a href="https://github.com/Crypto-hansolo/HOODL-Analytics" target="_blank" rel="noreferrer">GitHub repository ↗</a></div></aside><main><header><div><span className="breadcrumb">HOODL / <b>{tab.toUpperCase()}</b></span><h2>{tab === 'Overview' ? 'Token intelligence, without the noise.' : tab}</h2></div><div className="header-actions"><Badge tone={chain.error ? 'warn' : 'live'}>{chain.error ? 'RPC ERROR' : 'READ-ONLY'}</Badge><button className="refresh" disabled={loading} onClick={() => void load()} aria-label="Refresh live data">{loading ? '↻ Updating…' : '↻ Refresh'}</button></div></header><div className="content"><TabContent tab={tab} token={token} chain={chain} poolV3={poolV3} quote={quote} indexed={indexed} /></div><footer><span>HOODL ANALYTICS · DATA INTEGRITY FIRST</span><span>Last refresh {new Date(updated).toLocaleTimeString()}</span></footer></main></div>
}

export default App
