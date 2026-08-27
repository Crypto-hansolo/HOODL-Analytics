import { CONFIGURED_POOL } from '../config'
import { ethBlockNumber, ethGetLogs } from './rpc'
import { decodeUniswapV3Swap, SWAP_TOPIC0 } from './uniswapV3Swaps'

export interface PoolSwap {
  hash: string
  blockNumber: number
  sender: string
  recipient: string
  amount0: bigint
  amount1: bigint
  sqrtPriceX96: bigint
  liquidity: bigint
  tick: number
}

/** Fetches a bounded, directly indexed slice of the configured V3 pool's Swap events. */
export async function getRecentPoolSwaps(pool: string = CONFIGURED_POOL.address, lookbackBlocks = 50_000): Promise<PoolSwap[]> {
  const latest = await ethBlockNumber()
  const fromBlock = latest > BigInt(lookbackBlocks) ? latest - BigInt(lookbackBlocks) : 0n
  const logs = await ethGetLogs({ address: pool, topics: [SWAP_TOPIC0], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: 'latest' })
  return logs.flatMap((log) => {
    try {
      const decoded = decodeUniswapV3Swap(log)
      return [{ ...decoded, hash: log.transactionHash, blockNumber: Number.parseInt(log.blockNumber, 16) }]
    } catch {
      return []
    }
  }).sort((a, b) => b.blockNumber - a.blockNumber)
}
