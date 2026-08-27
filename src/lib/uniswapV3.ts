// Dependency-free ABI encoding/decoding for the handful of read-only
// Uniswap V3 pool calls this dashboard needs. No external ABI/web3 library
// required — same hand-rolled approach as erc20.ts.
//
// Every value here is decoded straight from what the pool contract returns.
// Nothing is inferred, converted to a "price", or matched to a WETH address —
// callers get raw on-chain facts (addresses, fee tier, tick, liquidity,
// slot0 words) and must treat a thrown error as "unavailable".

import { ethCall } from './rpc'

// 4-byte selectors, verified against keccak256 of each function signature.
const SELECTOR = {
  token0: '0x0dfe1681', // token0()
  token1: '0xd21220a7', // token1()
  fee: '0xddca3f43', // fee()
  tickSpacing: '0xd0c93a7c', // tickSpacing()
  liquidity: '0x1a686502', // liquidity()
  slot0: '0x3850c7bd', // slot0()
} as const

function requireWord(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length < 64) throw new Error('Malformed ABI response (short word)')
  return clean
}

function decodeAddress(hex: string): string {
  const word = requireWord(hex)
  return '0x' + word.slice(24, 64)
}

function decodeUint(word: string): bigint {
  return BigInt('0x' + word)
}

// Decodes a two's-complement signed integer that the EVM has sign-extended
// to a full 32-byte word (used for Solidity's int24 `tick`/`tickSpacing`).
function decodeSignedWord(word: string): bigint {
  const value = BigInt('0x' + word)
  const signBit = 1n << 255n
  return value >= signBit ? value - (1n << 256n) : value
}

export interface Slot0 {
  sqrtPriceX96: bigint
  tick: number
  observationIndex: number
  observationCardinality: number
  observationCardinalityNext: number
  feeProtocol: number
  unlocked: boolean
}

function decodeSlot0(hex: string): Slot0 {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length < 64 * 7) throw new Error('Malformed slot0() response')
  const words = Array.from({ length: 7 }, (_, i) => clean.slice(i * 64, i * 64 + 64))
  return {
    sqrtPriceX96: decodeUint(words[0]),
    tick: Number(decodeSignedWord(words[1])),
    observationIndex: Number(decodeUint(words[2])),
    observationCardinality: Number(decodeUint(words[3])),
    observationCardinalityNext: Number(decodeUint(words[4])),
    feeProtocol: Number(decodeUint(words[5])),
    unlocked: decodeUint(words[6]) !== 0n,
  }
}

export async function poolToken0(pool: string): Promise<string> {
  return decodeAddress(await ethCall(pool, SELECTOR.token0))
}

export async function poolToken1(pool: string): Promise<string> {
  return decodeAddress(await ethCall(pool, SELECTOR.token1))
}

export async function poolFee(pool: string): Promise<number> {
  return Number(decodeUint(requireWord(await ethCall(pool, SELECTOR.fee))))
}

export async function poolTickSpacing(pool: string): Promise<number> {
  return Number(decodeSignedWord(requireWord(await ethCall(pool, SELECTOR.tickSpacing))))
}

export async function poolLiquidity(pool: string): Promise<bigint> {
  return decodeUint(requireWord(await ethCall(pool, SELECTOR.liquidity)))
}

export async function poolSlot0(pool: string): Promise<Slot0> {
  return decodeSlot0(await ethCall(pool, SELECTOR.slot0))
}

export interface PoolV3Field<T> {
  status: 'on-chain' | 'unavailable'
  value: T | null
  error: string | null
}

export interface PoolV3Data {
  token0: PoolV3Field<string>
  token1: PoolV3Field<string>
  fee: PoolV3Field<number>
  tickSpacing: PoolV3Field<number>
  liquidity: PoolV3Field<bigint>
  slot0: PoolV3Field<Slot0>
}

/** A quote is only valid after the pool identifies HOODL/WETH and both decimals. */
export interface PoolSpotQuote {
  status: 'on-chain' | 'unavailable'
  wethPerHoodl: number | null
  token0Symbol: string | null
  token1Symbol: string | null
  error: string | null
}

function toField<T>(result: PromiseSettledResult<T>): PoolV3Field<T> {
  if (result.status === 'fulfilled') {
    return { status: 'on-chain', value: result.value, error: null }
  }
  const reason = result.reason
  return {
    status: 'unavailable',
    value: null,
    error: reason instanceof Error ? reason.message : 'RPC request failed or was blocked',
  }
}

export interface SpotQuoteInputs {
  poolV3: PoolV3Data
  hoodlAddress: string
  symbol0: string | null
  symbol1: string | null
  decimals0: number
  decimals1: number
}

// Pure derivation of the WETH/HOODL spot price from already-fetched pool
// data and token metadata. Does no I/O itself — callers fetch poolV3 fields
// and the token0/token1 symbols/decimals, then hand them in here. Any
// validation failure is caught and reported as an 'unavailable' quote rather
// than thrown, matching how callers previously handled this inline.
export function computeSpotQuote({ poolV3, hoodlAddress, symbol0, symbol1, decimals0, decimals1 }: SpotQuoteInputs): PoolSpotQuote {
  try {
    const token0 = poolV3.token0.value
    const token1 = poolV3.token1.value
    const slot0 = poolV3.slot0.value
    if (poolV3.token0.status !== 'on-chain' || poolV3.token1.status !== 'on-chain' || poolV3.slot0.status !== 'on-chain' || !token0 || !token1 || !slot0) {
      throw new Error('Pool identity or slot0 unavailable')
    }
    const isHoodl0 = token0.toLowerCase() === hoodlAddress.toLowerCase() && symbol1?.toUpperCase() === 'WETH'
    const isHoodl1 = token1.toLowerCase() === hoodlAddress.toLowerCase() && symbol0?.toUpperCase() === 'WETH'
    if ((!isHoodl0 && !isHoodl1) || !symbol0 || !symbol1 || slot0.sqrtPriceX96 === 0n) {
      throw new Error('Pool is not verified as HOODL/WETH')
    }
    const rawToken1PerToken0 = (Number(slot0.sqrtPriceX96) ** 2 / 2 ** 192) * 10 ** (decimals0 - decimals1)
    const wethPerHoodl = isHoodl0 ? rawToken1PerToken0 : 1 / rawToken1PerToken0
    if (!Number.isFinite(wethPerHoodl)) throw new Error('Derived spot price is not finite')
    return { status: 'on-chain', wethPerHoodl, token0Symbol: symbol0, token1Symbol: symbol1, error: null }
  } catch (err) {
    return { status: 'unavailable', wethPerHoodl: null, token0Symbol: null, token1Symbol: null, error: err instanceof Error ? err.message : 'Pool quote unavailable' }
  }
}

// Fetches every pool field independently (Promise.allSettled) so a revert or
// CORS block on one call never hides fields that did succeed — each field
// carries its own on-chain/unavailable status instead of an all-or-nothing result.
export async function fetchPoolV3Data(pool: string): Promise<PoolV3Data> {
  const [token0, token1, fee, tickSpacing, liquidity, slot0] = await Promise.allSettled([
    poolToken0(pool),
    poolToken1(pool),
    poolFee(pool),
    poolTickSpacing(pool),
    poolLiquidity(pool),
    poolSlot0(pool),
  ])
  return {
    token0: toField(token0),
    token1: toField(token1),
    fee: toField(fee),
    tickSpacing: toField(tickSpacing),
    liquidity: toField(liquidity),
    slot0: toField(slot0),
  }
}
