// Hand-rolled ABI encode/decode for the handful of standard ERC-20 read calls
// this dashboard needs. No external ABI/web3 library required.

import { ethCall } from './rpc'

const SELECTOR = {
  balanceOf: '0x70a08231',
  totalSupply: '0x18160ddd',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  name: '0x06fdde03',
} as const

// keccak256("Transfer(address,address,uint256)")
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function encodeAddress(address: string): string {
  return address.toLowerCase().replace('0x', '').padStart(64, '0')
}

function hexToBigInt(hex: string): bigint {
  if (!hex || hex === '0x') return 0n
  return BigInt(hex)
}

// Decodes a dynamic ABI `string` return value (offset + length + utf8 bytes).
function decodeAbiString(hex: string): string | null {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length < 128) {
    // Some non-standard ERC20s (e.g. MKR-style) return a fixed bytes32 instead
    // of a dynamic string. Try decoding as bytes32 utf8.
    if (clean.length === 64) {
      return decodeBytes32Utf8(clean)
    }
    return null
  }
  try {
    const lengthWord = clean.slice(64, 128)
    const length = Number.parseInt(lengthWord, 16)
    const dataHex = clean.slice(128, 128 + length * 2)
    const bytes = new Uint8Array(dataHex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(dataHex.slice(i * 2, i * 2 + 2), 16)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function decodeBytes32Utf8(clean: string): string | null {
  try {
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
    }
    const trimmed = bytes.filter((b) => b !== 0)
    return new TextDecoder().decode(trimmed) || null
  } catch {
    return null
  }
}

export async function erc20BalanceOf(token: string, holder: string): Promise<bigint> {
  const result = await ethCall(token, SELECTOR.balanceOf + encodeAddress(holder))
  return hexToBigInt(result)
}

export async function erc20TotalSupply(token: string): Promise<bigint> {
  const result = await ethCall(token, SELECTOR.totalSupply)
  return hexToBigInt(result)
}

export async function erc20Decimals(token: string): Promise<number> {
  const result = await ethCall(token, SELECTOR.decimals)
  return Number(hexToBigInt(result))
}

export async function erc20Symbol(token: string): Promise<string | null> {
  const result = await ethCall(token, SELECTOR.symbol)
  return decodeAbiString(result)
}

export async function erc20Name(token: string): Promise<string | null> {
  const result = await ethCall(token, SELECTOR.name)
  return decodeAbiString(result)
}

export function topicToAddress(topic: string): string {
  return '0x' + topic.slice(-40)
}
