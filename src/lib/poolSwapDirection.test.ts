import { describe, expect, it } from 'vitest'
import { classifySwapDirection } from './poolSwapDirection'

describe('classifySwapDirection', () => {
  it('classifies token0 buys and sells', () => {
    expect(classifySwapDirection({ amount0: -100n, amount1: 40n, hoodlIsToken0: true })).toEqual({ side: 'buy', hoodlAmount: 100n })
    expect(classifySwapDirection({ amount0: 50n, amount1: -20n, hoodlIsToken0: true })).toEqual({ side: 'sell', hoodlAmount: 50n })
  })
  it('classifies token1 buys and sells', () => {
    expect(classifySwapDirection({ amount0: 30n, amount1: -75n, hoodlIsToken0: false })).toEqual({ side: 'buy', hoodlAmount: 75n })
    expect(classifySwapDirection({ amount0: -10n, amount1: 30n, hoodlIsToken0: false })).toEqual({ side: 'sell', hoodlAmount: 30n })
  })
  it('handles a zero delta without throwing', () => {
    expect(classifySwapDirection({ amount0: 0n, amount1: 15n, hoodlIsToken0: true })).toEqual({ side: 'sell', hoodlAmount: 0n })
  })
})
