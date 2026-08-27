import { afterEach, describe, expect, it, vi } from 'vitest'
import { erc20BalanceOf, erc20Decimals, erc20Name, erc20Symbol, erc20TotalSupply, topicToAddress, TRANSFER_TOPIC } from './erc20'
import { ethCall } from './rpc'

vi.mock('./rpc', () => ({ ethCall: vi.fn() }))

const mockedEthCall = vi.mocked(ethCall)

// Builds the ABI encoding for a dynamic `string` return value: offset word,
// length word, then the utf8 bytes right-padded to a 32-byte boundary.
function encodeAbiString(value: string): string {
  const bytes = Array.from(new TextEncoder().encode(value))
  const dataHex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  const paddedLength = Math.ceil(dataHex.length / 64) * 64 || 64
  const offsetWord = (32).toString(16).padStart(64, '0')
  const lengthWord = bytes.length.toString(16).padStart(64, '0')
  return '0x' + offsetWord + lengthWord + dataHex.padEnd(paddedLength, '0')
}

// Builds a fixed bytes32 utf8 return value (the MKR-style non-standard ERC20 case).
function encodeBytes32String(value: string): string {
  const bytes = Array.from(new TextEncoder().encode(value))
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return '0x' + hex.padEnd(64, '0')
}

function word(hex: string): string {
  return '0x' + hex.padStart(64, '0')
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('erc20BalanceOf', () => {
  it('decodes a uint256 balance as a bigint', async () => {
    mockedEthCall.mockResolvedValue(word('2710'))
    await expect(erc20BalanceOf('0xToken', '0xHolder')).resolves.toBe(10_000n)
  })

  it('treats an empty result as zero', async () => {
    mockedEthCall.mockResolvedValue('0x')
    await expect(erc20BalanceOf('0xToken', '0xHolder')).resolves.toBe(0n)
  })
})

describe('erc20TotalSupply', () => {
  it('decodes a uint256 supply as a bigint', async () => {
    mockedEthCall.mockResolvedValue(word('3e8'))
    await expect(erc20TotalSupply('0xToken')).resolves.toBe(1_000n)
  })
})

describe('erc20Decimals', () => {
  it('decodes a uint8 decimals value as a number', async () => {
    mockedEthCall.mockResolvedValue(word('12'))
    await expect(erc20Decimals('0xToken')).resolves.toBe(18)
  })
})

describe('erc20Symbol / erc20Name', () => {
  it('decodes a standard dynamic ABI string', async () => {
    mockedEthCall.mockResolvedValue(encodeAbiString('HOODL'))
    await expect(erc20Symbol('0xToken')).resolves.toBe('HOODL')
  })

  it('falls back to bytes32 utf8 decoding for non-standard tokens', async () => {
    mockedEthCall.mockResolvedValue(encodeBytes32String('MKR'))
    await expect(erc20Symbol('0xToken')).resolves.toBe('MKR')
  })

  it('decodes the token name the same way as symbol', async () => {
    mockedEthCall.mockResolvedValue(encodeAbiString('HOODL Token'))
    await expect(erc20Name('0xToken')).resolves.toBe('HOODL Token')
  })

  it('returns null when the response is too short to decode', async () => {
    mockedEthCall.mockResolvedValue('0x1234')
    await expect(erc20Symbol('0xToken')).resolves.toBeNull()
  })
})

describe('topicToAddress', () => {
  it('extracts the low 20 bytes of a padded log topic', () => {
    const topic = '0x000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd'
    expect(topicToAddress(topic)).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
  })
})

describe('TRANSFER_TOPIC', () => {
  it('is the keccak256 selector for Transfer(address,address,uint256)', () => {
    expect(TRANSFER_TOPIC).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')
  })
})
