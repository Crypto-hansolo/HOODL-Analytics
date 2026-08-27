import { describe, expect, it } from 'vitest'
import { computeSpotQuote } from './uniswapV3'
import type { PoolV3Data, PoolV3Field, Slot0 } from './uniswapV3'

const HOODL = '0x9fb3c2D71424122a5886DaC627177385d185DF09'
const WETH = '0x4200000000000000000000000000000000000006'

function field<T>(value: T): PoolV3Field<T> {
  return { status: 'on-chain', value, error: null }
}

function unavailableField<T>(error = 'RPC request failed or was blocked'): PoolV3Field<T> {
  return { status: 'unavailable', value: null, error }
}

function slot0(sqrtPriceX96: bigint): Slot0 {
  return {
    sqrtPriceX96,
    tick: 0,
    observationIndex: 0,
    observationCardinality: 1,
    observationCardinalityNext: 1,
    feeProtocol: 0,
    unlocked: true,
  }
}

function poolV3(overrides: Partial<PoolV3Data> = {}): PoolV3Data {
  return {
    token0: field(HOODL),
    token1: field(WETH),
    fee: field(3000),
    tickSpacing: field(60),
    liquidity: field(1_000_000n),
    slot0: field(slot0(2n ** 96n)), // sqrtPriceX96 == 2^96 -> raw ratio 1:1 before decimals
    ...overrides,
  }
}

describe('computeSpotQuote', () => {
  it('derives WETH-per-HOODL when HOODL is token0', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3(),
      hoodlAddress: HOODL,
      symbol0: 'HOODL',
      symbol1: 'WETH',
      decimals0: 18,
      decimals1: 18,
    })
    expect(quote).toEqual({ status: 'on-chain', wethPerHoodl: 1, token0Symbol: 'HOODL', token1Symbol: 'WETH', error: null })
  })

  it('inverts the ratio when HOODL is token1', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3({ token0: field(WETH), token1: field(HOODL) }),
      hoodlAddress: HOODL,
      symbol0: 'WETH',
      symbol1: 'HOODL',
      decimals0: 18,
      decimals1: 18,
    })
    expect(quote.status).toBe('on-chain')
    expect(quote.wethPerHoodl).toBe(1)
  })

  it('adjusts the ratio for differing token decimals', () => {
    // sqrtPriceX96 = 2^96 gives a raw token1/token0 ratio of 1 before the
    // decimals adjustment; token0 has 2 more decimals than token1 here.
    const quote = computeSpotQuote({
      poolV3: poolV3(),
      hoodlAddress: HOODL,
      symbol0: 'HOODL',
      symbol1: 'WETH',
      decimals0: 20,
      decimals1: 18,
    })
    expect(quote.status).toBe('on-chain')
    expect(quote.wethPerHoodl).toBeCloseTo(100, 6)
  })

  it('is unavailable when token0/token1 identity is not on-chain', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3({ token0: unavailableField('boom') }),
      hoodlAddress: HOODL,
      symbol0: 'HOODL',
      symbol1: 'WETH',
      decimals0: 18,
      decimals1: 18,
    })
    expect(quote).toEqual({
      status: 'unavailable',
      wethPerHoodl: null,
      token0Symbol: null,
      token1Symbol: null,
      error: 'Pool identity or slot0 unavailable',
    })
  })

  it('is unavailable when slot0 is not on-chain', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3({ slot0: unavailableField('boom') }),
      hoodlAddress: HOODL,
      symbol0: 'HOODL',
      symbol1: 'WETH',
      decimals0: 18,
      decimals1: 18,
    })
    expect(quote.status).toBe('unavailable')
    expect(quote.error).toBe('Pool identity or slot0 unavailable')
  })

  it('is unavailable when neither token pairs HOODL with WETH by symbol', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3(),
      hoodlAddress: HOODL,
      symbol0: 'HOODL',
      symbol1: 'USDC',
      decimals0: 18,
      decimals1: 6,
    })
    expect(quote.status).toBe('unavailable')
    expect(quote.error).toBe('Pool is not verified as HOODL/WETH')
  })

  it('is unavailable when neither token is HOODL at all', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3({ token0: field(WETH), token1: field('0xOtherToken00000000000000000000000000000') }),
      hoodlAddress: HOODL,
      symbol0: 'WETH',
      symbol1: 'OTHER',
      decimals0: 18,
      decimals1: 18,
    })
    expect(quote.status).toBe('unavailable')
    expect(quote.error).toBe('Pool is not verified as HOODL/WETH')
  })

  it('is unavailable when sqrtPriceX96 is zero', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3({ slot0: field(slot0(0n)) }),
      hoodlAddress: HOODL,
      symbol0: 'HOODL',
      symbol1: 'WETH',
      decimals0: 18,
      decimals1: 18,
    })
    expect(quote.status).toBe('unavailable')
    expect(quote.error).toBe('Pool is not verified as HOODL/WETH')
  })

  it('is unavailable when either erc20 symbol lookup failed', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3(),
      hoodlAddress: HOODL,
      symbol0: null,
      symbol1: 'WETH',
      decimals0: 18,
      decimals1: 18,
    })
    expect(quote.status).toBe('unavailable')
    expect(quote.error).toBe('Pool is not verified as HOODL/WETH')
  })

  it('matches HOODL/WETH symbols case-insensitively', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3(),
      hoodlAddress: HOODL,
      symbol0: 'hoodl',
      symbol1: 'weth',
      decimals0: 18,
      decimals1: 18,
    })
    expect(quote.status).toBe('on-chain')
  })

  it('matches the HOODL address case-insensitively', () => {
    const quote = computeSpotQuote({
      poolV3: poolV3({ token0: field(HOODL.toLowerCase()) }),
      hoodlAddress: HOODL,
      symbol0: 'HOODL',
      symbol1: 'WETH',
      decimals0: 18,
      decimals1: 18,
    })
    expect(quote.status).toBe('on-chain')
  })

  it('is unavailable when the derived price is not finite', () => {
    // decimals1 vastly larger than decimals0 drives the ratio to 0, and the
    // inverse (token1-is-HOODL) branch would divide by zero / overflow —
    // exercised here via an extreme decimals skew on the token0-is-HOODL branch's
    // sibling case: HOODL as token1 with a zero raw ratio inverted to Infinity.
    const quote = computeSpotQuote({
      poolV3: poolV3({ token0: field(WETH), token1: field(HOODL), slot0: field(slot0(1n)) }),
      hoodlAddress: HOODL,
      symbol0: 'WETH',
      symbol1: 'HOODL',
      decimals0: 0,
      decimals1: 300,
    })
    expect(quote.status).toBe('unavailable')
    expect(quote.error).toBe('Derived spot price is not finite')
  })
})
