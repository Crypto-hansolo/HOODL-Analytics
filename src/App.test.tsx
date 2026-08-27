// @vitest-environment jsdom
//
// Integration coverage for the one file with none: App.tsx orchestrates every
// RPC/Blockscout/snapshot read, decides what counts as a "successful source",
// and is the only place that turns all of that into the on-chain/indexed/
// unavailable badges the rest of the app promises are honest. A regression
// here (e.g. showing fabricated data, or never leaving the connecting state)
// would only be caught by a human staring at the deployed dashboard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from './App'
import { CHAIN, CONFIGURED_POOL, HOODL_TOKEN } from './config'

const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function encodeUint(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, '0')
}

function encodeAddressWord(address: string): string {
  return address.toLowerCase().replace('0x', '').padStart(64, '0')
}

// Builds the ABI encoding for a dynamic `string` return value: offset word,
// length word, then the utf8 bytes right-padded to a 32-byte boundary.
function encodeAbiString(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const paddedLength = Math.ceil(bytes.length / 32) * 64 || 64
  return `${encodeUint(32)}${encodeUint(bytes.length)}${toHex(bytes).padEnd(paddedLength, '0')}`
}

// Dispatches a canned response for every read-only eth_call this dashboard
// makes, keyed by 4-byte selector (and, where a selector is reused across
// tokens, by the `to` address) so the mocked pool looks like a real
// HOODL/WETH V3 pool instead of an all-zero contract.
function ethCallHex(to: string, data: string): string {
  const selector = data.slice(0, 10)
  const isWeth = to.toLowerCase() === WETH_ADDRESS.toLowerCase()
  switch (selector) {
    case '0x06fdde03': // name()
      return encodeAbiString(isWeth ? 'Wrapped Ether' : 'Hoodl The Fox')
    case '0x95d89b41': // symbol()
      return encodeAbiString(isWeth ? 'WETH' : 'HOODL')
    case '0x313ce567': // decimals()
      return encodeUint(isWeth ? 18 : 9)
    case '0x18160ddd': // totalSupply()
      return encodeUint(1_000_000_000n * 10n ** 9n)
    case '0x0dfe1681': // token0()
      return encodeAddressWord(HOODL_TOKEN.address)
    case '0xd21220a7': // token1()
      return encodeAddressWord(WETH_ADDRESS)
    case '0xddca3f43': // fee()
      return encodeUint(3000)
    case '0xd0c93a7c': // tickSpacing()
      return encodeUint(60)
    case '0x1a686502': // liquidity()
      return encodeUint(123_456_789)
    case '0x3850c7bd': // slot0()
      return [encodeUint(2n ** 96n), encodeUint(12_345), encodeUint(0), encodeUint(1), encodeUint(1), encodeUint(0), encodeUint(1)].join('')
    default:
      throw new Error(`Unhandled eth_call selector ${selector}`)
  }
}

function rpcResult(method: string, params: unknown[]): unknown {
  switch (method) {
    case 'eth_chainId':
      return `0x${CHAIN.id.toString(16)}`
    case 'eth_blockNumber':
      return '0x64'
    case 'eth_getCode':
      return '0x6080604052'
    case 'eth_getLogs':
      return []
    case 'eth_call': {
      const [{ to, data }] = params as [{ to: string; data: string }]
      return `0x${ethCallHex(to, data)}`
    }
    default:
      throw new Error(`Unhandled RPC method ${method}`)
  }
}

// Mirrors the real chain: Blockscout has no exchange_rate for the long-tail
// HOODL token itself, only for well-known tokens like WETH (see
// wethTokenInfoPayload below) — this is what forces Overview onto the
// on-chain-derived USD fallback.
const tokenInfoPayload = {
  name: 'Hoodl The Fox',
  symbol: 'HOODL',
  decimals: '9',
  total_supply: '1000000000000000000',
  holders_count: 42,
  exchange_rate: null,
  volume_24h: '1234.56',
}

const wethTokenInfoPayload = {
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: '18',
  total_supply: '1000000000000000000000',
  holders_count: 500000,
  exchange_rate: '2500.5',
  volume_24h: null,
}

const transfersPayload = {
  items: [
    {
      transaction_hash: '0xabc',
      from: { hash: '0x1111111111111111111111111111111111111111' },
      to: { hash: '0x2222222222222222222222222222222222222222' },
      total: { value: '5000000000' },
      timestamp: new Date().toISOString(),
      block_number: 100,
    },
  ],
}

const holdersPayload = {
  items: [{ address: { hash: '0x3333333333333333333333333333333333333333' }, value: '900000000000000000' }],
}

const snapshotPayload = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  source: { name: 'Blockscout API v2', url: 'https://example.invalid', chainId: CHAIN.id, token: HOODL_TOKEN.address, pool: CONFIGURED_POOL.address },
  coverage: { kind: 'recent-token-transfers', pagesFetched: 1, maxPages: 20, coverageComplete7d: true, oldestTransferAt: null, note: 'ok' },
  transfers: [],
  activity: { transfers1h: 1, transfers24h: 2, transfers7d: 3 },
  history: [],
  holders: [],
  holdersComplete: false,
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  if (url === CHAIN.rpcUrl) {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }
    return Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: body.id, result: rpcResult(body.method, body.params) }))
  }
  if (url.includes('/holders')) return Promise.resolve(jsonResponse(holdersPayload))
  if (url.includes('/transfers')) return Promise.resolve(jsonResponse(transfersPayload))
  if (url.toLowerCase() === `${CHAIN.blockscoutApiBase}/tokens/${WETH_ADDRESS}`.toLowerCase()) return Promise.resolve(jsonResponse(wethTokenInfoPayload))
  if (url.includes(`${CHAIN.blockscoutApiBase}/tokens/`)) return Promise.resolve(jsonResponse(tokenInfoPayload))
  if (url.endsWith('data/snapshot.json')) return Promise.resolve(jsonResponse(snapshotPayload))
  return Promise.reject(new Error(`Unexpected fetch to ${url}`))
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(mockFetch))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('shows a connecting state before the first load resolves', () => {
    render(<App />)
    expect(screen.getByText(/Connecting to Robinhood Chain/i)).toBeTruthy()
  })

  it('renders verified on-chain and indexed data once every source resolves, and switches tabs', async () => {
    render(<App />)
    expect(await screen.findByText('Hoodl The Fox')).toBeTruthy()
    expect(screen.getByText('READ-ONLY')).toBeTruthy()
    // Total supply (1_000_000_000 HOODL at 9 decimals) formatted compactly.
    expect(screen.getByText('1.00B')).toBeTruthy()
    expect(screen.queryByText(/Connecting to Robinhood Chain/i)).toBeNull()

    // The on-chain WETH/HOODL spot quote must render a real value on
    // Overview even though Blockscout has no exchange_rate for HOODL itself
    // (mocked as null above, matching the real chain).
    expect(await screen.findByText('Spot price (WETH)')).toBeTruthy()
    expect(screen.getByText('0.000000001')).toBeTruthy()
    // USD falls back to on-chain spot × Blockscout's WETH exchange rate,
    // clearly labeled as derived rather than HOODL's own indexed price.
    expect(screen.getByText(/^\$0\.0000025005/)).toBeTruthy()
    expect(screen.getByText(/Blockscout WETH\/USD exchange rate/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Holders/i }))
    expect(screen.getByText('Wallet lookup')).toBeTruthy()
  })

  it('degrades to an honest "unavailable" state instead of fabricating data when every source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    render(<App />)
    // "RPC unavailable" only renders once the chain read's catch handler has
    // actually run and set chain.error — unlike the header's "CHECK RPC"
    // badge, which is also true on the very first render (chainId starts
    // null), so waiting on it would pass even before the mocked failure occurs.
    expect(await screen.findByText('RPC unavailable')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/network down/i).length).toBeGreaterThan(0)
  })
})
