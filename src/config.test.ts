import { describe, expect, it } from 'vitest'
import { CHAIN, CONFIGURED_POOL, HOODL_TOKEN, REFRESH_INTERVAL_MS, REQUEST_TIMEOUT_MS, STALE_AFTER_MS } from './config'

// Pins the exact configured facts this dashboard treats as ground truth.
// A change here is a deliberate config change, not an accidental one.
describe('config facts', () => {
  it('identifies Robinhood Chain', () => {
    expect(CHAIN.id).toBe(4663)
    expect(CHAIN.name).toBe('Robinhood Chain')
    expect(CHAIN.rpcUrl).toBe('https://rpc.mainnet.chain.robinhood.com')
    expect(CHAIN.explorerUrl).toBe('https://robinhoodchain.blockscout.com')
    expect(CHAIN.blockscoutApiBase).toBe('https://robinhoodchain.blockscout.com/api/v2')
  })

  it('configures the HOODL token address and symbol', () => {
    expect(HOODL_TOKEN.address).toBe('0x9fb3c2D71424122a5886DaC627177385d185DF09')
    expect(HOODL_TOKEN.symbol).toBe('HOODL')
  })

  it('configures the HOODL/WETH Uniswap V3 pool', () => {
    expect(CONFIGURED_POOL.address).toBe('0xF87761231646DA4aa00905c237EaCbfF112Df930')
    expect(CONFIGURED_POOL.pair).toBe('HOODL/WETH')
    expect(CONFIGURED_POOL.poolType).toBe('Uniswap V3')
  })

  it('sets refresh, staleness, and timeout intervals in milliseconds', () => {
    expect(REFRESH_INTERVAL_MS).toBe(30_000)
    expect(STALE_AFTER_MS).toBe(90_000)
    expect(REQUEST_TIMEOUT_MS).toBe(10_000)
  })
})
