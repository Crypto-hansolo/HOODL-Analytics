import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { CHAIN, CONFIGURED_POOL, HOODL_TOKEN, STALE_AFTER_MS } from './config'
import { erc20BalanceOf, erc20Decimals, erc20Name, erc20Symbol, erc20TotalSupply } from './lib/erc20'
import { ethBlockNumber, ethChainId, ethGetCode, RpcError } from './lib/rpc'
import { formatCompactUnits, formatInteger, formatUnits, isValidAddress, truncateAddress } from './lib/format'

type Tab = 'Overview' | 'Trading' | 'Fees & Rewards' | 'Pools' | 'Holders'
type ChainState = { chainId: number | null; block: bigint | null; deployed: boolean | null; error: string | null }
type TokenState = { name: string | null; symbol: string | null; decimals: number | null; supply: bigint | null; error: string | null }

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

function Chart({ title, subtitle }: { title: string; subtitle: string }) {
  return <section className="panel chart-panel"><div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div><div className="range"><button className="selected">24H</button><button>7D</button><button>30D</button><button>ALL</button></div></div><div className="chart-empty"><svg viewBox="0 0 800 190" preserveAspectRatio="none" aria-hidden="true"><path d="M0 150H800M0 100H800M0 50H800" /><path className="ghost-line" d="M0 150 C100 145 130 120 210 132 S340 80 420 110 S570 55 640 86 S735 72 800 42" /></svg><div><span>Chart data unavailable</span><small>Connect a verified DEX/indexer provider to populate historical analytics.</small></div></div></section>
}

function Overview({ token, chain }: { token: TokenState; chain: ChainState }) {
  return <>
    <div className="hero-grid"><div className="hero-copy"><Badge tone="live">READ-ONLY TERMINAL</Badge><h1>Understand the<br /><em>HOODL economy.</em></h1><p>Track trading activity, liquidity, and WETH distributions on Robinhood Chain — with every metric sourced, timestamped, and honest.</p><div className="hero-links"><a href={`${CHAIN.explorerUrl}/token/${HOODL_TOKEN.address}`} target="_blank" rel="noreferrer">View token on Blockscout ↗</a><span>·</span><span>Chain {CHAIN.id}</span></div></div><div className="network-card"><div className="network-orbit"><span>H</span></div><div><span className="eyebrow">NETWORK STATUS</span><h3>{CHAIN.name}</h3><Badge tone={chain.error ? 'warn' : 'live'}>{chain.error ? 'RPC unavailable' : 'Read-only connected'}</Badge></div><div className="network-meta"><span>Chain ID <b>{chain.chainId ?? CHAIN.id}</b></span><span>Latest block <b>{chain.block ? formatInteger(Number(chain.block)) : '—'}</b></span></div></div></div>
    <div className="metrics"><Metric label="Token name" value={token.name ?? 'HOODL'} source={token.name ? 'On-chain' : 'Unavailable'} accent /><Metric label="Symbol" value={token.symbol ?? 'HOODL'} source={token.symbol ? 'On-chain' : 'Unavailable'} /><Metric label="Total supply" value={token.supply !== null && token.decimals !== null ? formatCompactUnits(token.supply, token.decimals) : '—'} source={token.supply ? 'Calculated' : 'Unavailable'} /><Metric label="Price" value="—" /><Metric label="24h volume" value="—" /><Metric label="WETH distributed" value="—" /></div>
    <div className="two-col"><Chart title="Trading activity" subtitle="Volume over time · exact values appear when indexed" /><section className="panel status-panel"><div className="panel-head"><div><h2>Data integrity</h2><p>What is verified right now</p></div><Badge tone="live">TRANSPARENT</Badge></div><div className="status-row"><span><i className="dot green" />Token contract</span><b>{token.error ? 'Unavailable' : 'Configured'}</b></div><div className="status-row"><span><i className="dot green" />Network identity</span><b>{chain.chainId === CHAIN.id ? 'Confirmed' : 'Pending'}</b></div><div className="status-row"><span><i className="dot gray" />DEX / pool analytics</span><b>Awaiting indexer</b></div><div className="status-row"><span><i className="dot gray" />Fees / WETH rewards</span><b>Awaiting verification</b></div><div className="source-note">No mock values are shipped. Unknown metrics stay unavailable until a verified source is configured.</div></section></div>
    <div className="two-col"><section className="panel contract-panel"><div className="panel-head"><div><h2>Contracts</h2><p>Centralized, clickable configuration</p></div></div><div className="address-row"><span><label>HOODL TOKEN</label><code>{HOODL_TOKEN.address}</code></span><a href={`${CHAIN.explorerUrl}/address/${HOODL_TOKEN.address}`} target="_blank" rel="noreferrer">↗</a></div><div className="address-row"><span><label>CONFIGURED POOL · UNVERIFIED MECHANICS</label><code>{CONFIGURED_POOL.address}</code></span><a href={`${CHAIN.explorerUrl}/address/${CONFIGURED_POOL.address}`} target="_blank" rel="noreferrer">↗</a></div></section><section className="panel block-panel"><div className="panel-head"><div><h2>On-chain snapshot</h2><p>Freshness is shown, never implied</p></div><Badge tone={chain.error ? 'warn' : 'live'}>{chain.error ? 'STALE' : 'LIVE'}</Badge></div><div className="snapshot"><span>Last updated <b>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></span><span>Contract deployed <b>{chain.deployed === null ? '—' : chain.deployed ? 'Yes' : 'No'}</b></span><span>Decimals <b>{token.decimals ?? '—'}</b></span></div></section></div>
  </>
}

function WalletLookup() {
  const [address, setAddress] = useState(''); const [result, setResult] = useState<string | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); setResult(null); if (!isValidAddress(address)) { setError('Enter a valid 20-byte wallet address.'); return } setBusy(true); try { const [balance, decimals] = await Promise.all([erc20BalanceOf(HOODL_TOKEN.address, address), erc20Decimals(HOODL_TOKEN.address)]); setResult(`${formatUnits(balance, decimals)} HOODL`) } catch (err) { setError(err instanceof RpcError ? err.message : 'RPC request failed or was blocked.') } finally { setBusy(false) } }
  return <section className="panel wallet"><div className="panel-head"><div><h2>Wallet lookup</h2><p>Public read-only balanceOf() query</p></div><Badge tone="live">ON-CHAIN</Badge></div><form onSubmit={submit}><input value={address} onChange={e => setAddress(e.target.value)} placeholder="0x wallet address" spellCheck={false} /><button disabled={busy}>{busy ? 'Reading…' : 'Query balance ↗'}</button></form>{error && <p className="form-error">{error}</p>}{result && <div className="wallet-result"><span>HOODL balance</span><b>{result}</b><code>{truncateAddress(address)}</code></div>}</section>
}

function TabContent({ tab, token, chain }: { tab: Tab; token: TokenState; chain: ChainState }) {
  if (tab === 'Overview') return <Overview token={token} chain={chain} />
  if (tab === 'Holders') return <><div className="metrics"><Metric label="Current holders" value="—" /><Metric label="Holder growth" value="—" /><Metric label="Top 10 concentration" value="—" /><Metric label="WETH earned" value="—" /></div><WalletLookup /><EmptyState title="Holder analytics awaiting indexing" body="A complete holder ranking requires indexed HOODL Transfer events. No holder counts or concentration figures are invented." todo="Configure a transfer-event indexer and persist holder snapshots." /></>
  if (tab === 'Pools') return <><section className="panel pool-card"><div><Badge tone="muted">CONFIGURED · UNVERIFIED</Badge><h2>Liquidity pool</h2><code>{CONFIGURED_POOL.address}</code><p>Address supplied for HOODL analytics. DEX, pair composition, ABI, reserves, and fee tier are not yet verified.</p></div><a className="outline-btn" href={`${CHAIN.explorerUrl}/address/${CONFIGURED_POOL.address}`} target="_blank" rel="noreferrer">Open explorer ↗</a></section><EmptyState title="Pool analytics unavailable" body="TVL, volume, price impact, and fees require verified pool semantics and an indexed data provider." todo="Verify the pool contract and add its provider to the modular data layer." /></>
  const title = tab === 'Trading' ? 'Trading analytics' : 'Fees & rewards'
  return <><div className="metrics"><Metric label="Total volume" value="—" /><Metric label={tab === 'Trading' ? 'Buy / sell ratio' : 'Generated fees'} value="—" /><Metric label={tab === 'Trading' ? 'Unique traders' : 'WETH distributed'} value="—" /><Metric label={tab === 'Trading' ? 'Largest trade' : 'Distribution efficiency'} value="—" /></div><Chart title={title} subtitle="Historical values will appear after verified indexing" /><EmptyState title={`${title} data unavailable`} body="No unverified DEX, fee, reward, or volume values are displayed." todo="Connect a verified indexer and document the event semantics before enabling calculations." /></>
}

function App() {
  const [tab, setTab] = useState<Tab>('Overview'); const [token, setToken] = useState<TokenState>({ name: null, symbol: null, decimals: null, supply: null, error: null }); const [chain, setChain] = useState<ChainState>({ chainId: null, block: null, deployed: null, error: null }); const [updated, setUpdated] = useState(Date.now())
  async function load() { try { const [name, symbol, decimals, supply] = await Promise.all([erc20Name(HOODL_TOKEN.address), erc20Symbol(HOODL_TOKEN.address), erc20Decimals(HOODL_TOKEN.address), erc20TotalSupply(HOODL_TOKEN.address)]); setToken({ name, symbol, decimals, supply, error: null }) } catch (err) { setToken(v => ({ ...v, error: err instanceof Error ? err.message : 'RPC unavailable' })) } try { const [chainId, block, code] = await Promise.all([ethChainId(), ethBlockNumber(), ethGetCode(HOODL_TOKEN.address)]); setChain({ chainId, block, deployed: code !== '0x', error: null }) } catch (err) { setChain(v => ({ ...v, error: err instanceof Error ? err.message : 'RPC unavailable' })) } setUpdated(Date.now()) }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer) }, [])
  const stale = Date.now() - updated > STALE_AFTER_MS
  return <div className="app-shell"><aside><div className="brand"><span className="brand-mark">H</span><span>HOODL <small>TERMINAL</small></span></div><div className="side-label">ANALYTICS</div><nav>{tabs.map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}><span className="nav-icon">{['◈', '⌁', '◌', '◇', '◎'][tabs.indexOf(item)]}</span>{item}</button>)}</nav><div className="side-bottom"><div className="connection"><i className={stale || chain.error ? 'offline' : ''} />{stale || chain.error ? 'RPC unavailable' : 'Live connection'}<small>Robinhood Chain · {CHAIN.id}</small></div><a href="https://github.com/Crypto-hansolo/HOODL-Analytics" target="_blank" rel="noreferrer">GitHub repository ↗</a></div></aside><main><header><div><span className="breadcrumb">HOODL / <b>{tab.toUpperCase()}</b></span><h2>{tab === 'Overview' ? 'Token intelligence, without the noise.' : tab}</h2></div><div className="header-actions"><Badge tone={chain.error ? 'warn' : 'live'}>{chain.error ? 'RPC ERROR' : 'READ-ONLY'}</Badge><button className="refresh" onClick={() => void load()}>↻ Refresh</button></div></header><div className="content"><TabContent tab={tab} token={token} chain={chain} /></div><footer><span>HOODL ANALYTICS · DATA INTEGRITY FIRST</span><span>Last refresh {new Date(updated).toLocaleTimeString()}</span></footer></main></div>
}

export default App
