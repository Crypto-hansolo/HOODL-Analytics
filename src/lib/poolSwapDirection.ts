// Classifies a decoded Uniswap V3 Swap event from the pool's signed token delta.
// A negative HOODL-side amount means the pool sent HOODL out (buy); positive
// means HOODL entered the pool (sell). Token ordering must be read on-chain.
export type SwapSide = 'buy' | 'sell'

export interface SwapDirectionInput {
  amount0: bigint
  amount1: bigint
  hoodlIsToken0: boolean
}

export interface SwapDirectionResult {
  side: SwapSide
  hoodlAmount: bigint
}

export function classifySwapDirection({ amount0, amount1, hoodlIsToken0 }: SwapDirectionInput): SwapDirectionResult {
  const hoodlSigned = hoodlIsToken0 ? amount0 : amount1
  return { side: hoodlSigned < 0n ? 'buy' : 'sell', hoodlAmount: hoodlSigned < 0n ? -hoodlSigned : hoodlSigned }
}
