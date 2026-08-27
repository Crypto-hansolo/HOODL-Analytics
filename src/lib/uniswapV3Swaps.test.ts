import { describe, expect, it } from 'vitest'
import { decodeUniswapV3Swap, SWAP_TOPIC0 } from './uniswapV3Swaps'
import type { UniswapV3RawLog } from './uniswapV3Swaps'

const SENDER = '0x11111111111111111111111111111111111111aa'
const RECIPIENT = '0x22222222222222222222222222222222222222bb'

function addressTopic(address: string): string {
  return '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0')
}

function unsignedWord(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

function signedWord(value: bigint): string {
  const asUint = value < 0n ? value + (1n << 256n) : value
  return asUint.toString(16).padStart(64, '0')
}

function buildLog(overrides: { amount0?: bigint; amount1?: bigint; sqrtPriceX96?: bigint; liquidity?: bigint; tick?: bigint } = {}): UniswapV3RawLog {
  const amount0 = overrides.amount0 ?? 1_000_000_000_000_000_000n
  const amount1 = overrides.amount1 ?? -2_000_000_000_000_000_000n
  const sqrtPriceX96 = overrides.sqrtPriceX96 ?? 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n
  const liquidity = overrides.liquidity ?? 123_456_789_012_345n
  const tick = overrides.tick ?? -123n

  const data = '0x' + signedWord(amount0) + signedWord(amount1) + unsignedWord(sqrtPriceX96) + unsignedWord(liquidity) + signedWord(tick)

  return {
    topics: [SWAP_TOPIC0, addressTopic(SENDER), addressTopic(RECIPIENT)],
    data,
  }
}

describe('decodeUniswapV3Swap', () => {
  it('uses the canonical Uniswap V3 Swap topic observed in pool logs', () => {
    expect(SWAP_TOPIC0).toBe('0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67')
  })

  it('decodes sender and recipient from indexed topics', () => {
    const swap = decodeUniswapV3Swap(buildLog())
    expect(swap.sender).toBe(SENDER)
    expect(swap.recipient).toBe(RECIPIENT)
  })

  it('decodes a positive amount0 and negative amount1 as signed int256', () => {
    const swap = decodeUniswapV3Swap(buildLog({ amount0: 1_000_000_000_000_000_000n, amount1: -2_000_000_000_000_000_000n }))
    expect(swap.amount0).toBe(1_000_000_000_000_000_000n)
    expect(swap.amount1).toBe(-2_000_000_000_000_000_000n)
  })

  it('decodes a negative amount0 as a signed int256', () => {
    const swap = decodeUniswapV3Swap(buildLog({ amount0: -987_654_321n, amount1: 555n }))
    expect(swap.amount0).toBe(-987_654_321n)
    expect(swap.amount1).toBe(555n)
  })

  it('decodes sqrtPriceX96 and liquidity as unsigned values', () => {
    const swap = decodeUniswapV3Swap(buildLog({ sqrtPriceX96: 79_228_162_514_264_337_593_543_950_336n, liquidity: 42n }))
    expect(swap.sqrtPriceX96).toBe(79_228_162_514_264_337_593_543_950_336n)
    expect(swap.liquidity).toBe(42n)
  })

  it('decodes a negative tick as a signed int24', () => {
    const swap = decodeUniswapV3Swap(buildLog({ tick: -887272n }))
    expect(swap.tick).toBe(-887272)
  })

  it('decodes a positive tick as a signed int24', () => {
    const swap = decodeUniswapV3Swap(buildLog({ tick: 887272n }))
    expect(swap.tick).toBe(887272)
  })

  it('rejects a log whose topic0 does not match the canonical Swap signature', () => {
    const log = buildLog()
    log.topics = ['0x' + 'ab'.repeat(32), log.topics[1], log.topics[2]]
    expect(() => decodeUniswapV3Swap(log)).toThrow(/topic0/i)
  })

  it('rejects a log with the wrong number of topics', () => {
    const log = buildLog()
    log.topics = [log.topics[0], log.topics[1]]
    expect(() => decodeUniswapV3Swap(log)).toThrow(/topic/i)
  })

  it('rejects data shorter than 5 ABI words', () => {
    const log = buildLog()
    log.data = log.data.slice(0, log.data.length - 64)
    expect(() => decodeUniswapV3Swap(log)).toThrow(/data/i)
  })

  it('rejects data longer than 5 ABI words', () => {
    const log = buildLog()
    log.data = log.data + '0'.repeat(64)
    expect(() => decodeUniswapV3Swap(log)).toThrow(/data/i)
  })

  it('matches topic0 case-insensitively', () => {
    const log = buildLog()
    log.topics = [SWAP_TOPIC0.toUpperCase().replace('0X', '0x'), log.topics[1], log.topics[2]]
    expect(() => decodeUniswapV3Swap(log)).not.toThrow()
  })
})
