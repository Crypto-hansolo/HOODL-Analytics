// Pure decoder for Uniswap V3 pool `Swap` event logs. No RPC calls, no
// external ABI library — same hand-rolled approach as uniswap V3.ts/erc20.ts.
// Callers hand in a raw log (topics + data hex) and get back typed fields or
// a thrown error; nothing here fetches or guesses at log data.

// keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
// Verified against the live pool logs endpoint and Uniswap V3's canonical event.
export const SWAP_TOPIC0 = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'

const WORD_HEX_LEN = 64

export interface UniswapV3RawLog {
  topics: string[]
  data: string
}

export interface UniswapV3Swap {
  sender: string
  recipient: string
  amount0: bigint
  amount1: bigint
  sqrtPriceX96: bigint
  liquidity: bigint
  tick: number
}

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
}

function decodeAddressTopic(topic: string): string {
  const clean = stripHexPrefix(topic)
  return '0x' + clean.slice(-40)
}

function decodeUnsignedWord(word: string): bigint {
  return BigInt('0x' + word)
}

function decodeSignedWord(word: string): bigint {
  const value = BigInt('0x' + word)
  const signBit = 1n << 255n
  return value >= signBit ? value - (1n << 256n) : value
}

export function decodeUniswapV3Swap(log: UniswapV3RawLog): UniswapV3Swap {
  if (log.topics.length !== 3) {
    throw new Error(`Malformed Swap log: expected 3 topics, got ${log.topics.length}`)
  }

  const [topic0, senderTopic, recipientTopic] = log.topics
  if (stripHexPrefix(topic0).toLowerCase() !== stripHexPrefix(SWAP_TOPIC0).toLowerCase()) {
    throw new Error('Malformed Swap log: topic0 does not match the canonical Swap event signature')
  }

  const data = stripHexPrefix(log.data)
  if (data.length !== WORD_HEX_LEN * 5) {
    throw new Error(`Malformed Swap log data: expected 5 ABI words, got ${data.length / WORD_HEX_LEN}`)
  }

  const words = Array.from({ length: 5 }, (_, i) => data.slice(i * WORD_HEX_LEN, i * WORD_HEX_LEN + WORD_HEX_LEN))
  const [amount0Word, amount1Word, sqrtPriceX96Word, liquidityWord, tickWord] = words

  return {
    sender: decodeAddressTopic(senderTopic),
    recipient: decodeAddressTopic(recipientTopic),
    amount0: decodeSignedWord(amount0Word),
    amount1: decodeSignedWord(amount1Word),
    sqrtPriceX96: decodeUnsignedWord(sqrtPriceX96Word),
    liquidity: decodeUnsignedWord(liquidityWord),
    tick: Number(decodeSignedWord(tickWord)),
  }
}
