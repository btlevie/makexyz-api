/**
 * Checksum validation for payment identifiers, so the payment rules only fire
 * on real addresses and account numbers - not on any long string that happens
 * to have the right shape (part numbers, order ids, file hashes).
 */
import { createHash } from 'node:crypto'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Decode(value: string): Buffer | null {
  let number = 0n
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character)
    if (digit === -1) return null
    number = number * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (number > 0n) {
    bytes.unshift(Number(number % 256n))
    number /= 256n
  }
  for (const character of value) {
    if (character !== '1') break
    bytes.unshift(0)
  }
  return Buffer.from(bytes)
}

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest()
}

/** Base58Check (Bitcoin legacy/P2SH and Tron addresses): the last 4 bytes are a double-SHA256 checksum. */
export function isValidBase58Check(value: string): boolean {
  const decoded = base58Decode(value)
  if (!decoded || decoded.length < 5) return false
  const payload = decoded.subarray(0, -4)
  const checksum = decoded.subarray(-4)
  return sha256(sha256(payload)).subarray(0, 4).equals(checksum)
}

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function bech32Polymod(values: number[]): number {
  let checksum = 1
  for (const value of values) {
    const top = checksum >> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) checksum ^= BECH32_GENERATORS[i]
    }
  }
  return checksum
}

/** Bech32/Bech32m ("bc1...") - native SegWit and Taproot Bitcoin addresses. */
export function isValidBech32(value: string): boolean {
  const lower = value.toLowerCase()
  const separator = lower.lastIndexOf('1')
  if (separator < 1 || separator + 7 > lower.length) return false
  const prefix = lower.slice(0, separator)
  const data: number[] = []
  for (const character of lower.slice(separator + 1)) {
    const index = BECH32_CHARSET.indexOf(character)
    if (index === -1) return false
    data.push(index)
  }
  const expanded = [
    ...[...prefix].map((character) => character.charCodeAt(0) >> 5),
    0,
    ...[...prefix].map((character) => character.charCodeAt(0) & 31),
  ]
  const polymod = bech32Polymod([...expanded, ...data])
  // 1 = Bech32 (SegWit v0), 0x2bc830a3 = Bech32m (Taproot).
  return polymod === 1 || polymod === 0x2bc830a3
}

/** IBAN: move the first four characters to the end, letters to numbers, and the result mod 97 is 1. */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const character of rearranged) {
    const digits = /\d/.test(character) ? character : String(character.charCodeAt(0) - 55)
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }
  return remainder === 1
}

/**
 * US ABA routing number checksum. One in ten random 9-digit numbers passes,
 * so callers must also require banking words nearby.
 */
export function isValidAbaRouting(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false
  const d = [...value].map(Number)
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])
  return sum % 10 === 0 && value !== '000000000'
}
