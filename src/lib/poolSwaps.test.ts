import { describe, expect, it, vi } from 'vitest'
import { getRecentPoolSwaps } from './poolSwaps'

const rpc = vi.hoisted(() => ({
  ethBlockNumber: vi.fn(),
  ethGetLogs: vi.fn(),
}))
vi.mock('./rpc', () => rpc)

describe('getRecentPoolSwaps', () => {
  it('bounds the RPC query, decodes valid events, and skips malformed logs', async () => {
    rpc.ethBlockNumber.mockResolvedValue(100_000n)
    rpc.ethGetLogs.mockResolvedValue([
      { address: '0xpool', transactionHash: '0xvalid', blockNumber: '0x186a0', topics: [
        '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
        `0x${'11'.padStart(64, '0')}`, `0x${'22'.padStart(64, '0')}`,
      ], data: `0x${'0'.repeat(64 * 5)}` },
      { address: '0xpool', transactionHash: '0xbad', blockNumber: '0x1869f', topics: [], data: '0x' },
    ])
    const result = await getRecentPoolSwaps('0xpool', 50_000)
    expect(rpc.ethGetLogs).toHaveBeenCalledWith(expect.objectContaining({ address: '0xpool', fromBlock: '0xc350', toBlock: 'latest', topics: [expect.any(String)] }))
    expect(result).toHaveLength(1)
    expect(result[0]?.hash).toBe('0xvalid')
  })
})
