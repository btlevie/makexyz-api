/**
 * Which IP addresses a link may point at. Anything private, loopback,
 * link-local, CGNAT, multicast, documentation/benchmark or cloud-metadata is
 * off limits - both as a link in a message (a phishing/SSRF tell) and as a
 * place the redirect fetcher will ever connect to.
 */
import { BlockList, isIP } from 'node:net'

const BLOCKED = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. the 169.254.169.254 metadata endpoint
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local, incl. fd00:ec2::254 (EC2 metadata over IPv6)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6')
}

/** Expands an IPv6 address to its eight 16-bit groups. */
function ipv6Groups(address: string): number[] | null {
  const [head, tail] = address.split('::')
  if (address.split('::').length > 2) return null
  const parse = (part: string) => (part ? part.split(':') : [])
  let headParts = parse(head)
  let tailParts = tail === undefined ? [] : parse(tail)

  // A trailing dotted IPv4 ("::ffff:1.2.3.4") counts as two groups.
  const expandV4 = (parts: string[]) => {
    const last = parts[parts.length - 1]
    if (last && last.includes('.')) {
      const octets = last.split('.').map(Number)
      return [
        ...parts.slice(0, -1),
        ((octets[0] << 8) | octets[1]).toString(16),
        ((octets[2] << 8) | octets[3]).toString(16),
      ]
    }
    return parts
  }
  if (tail === undefined) headParts = expandV4(headParts)
  else tailParts = expandV4(tailParts)

  const missing = 8 - headParts.length - tailParts.length
  if (tail === undefined ? missing !== 0 : missing < 0) return null
  const groups = [...headParts, ...Array(tail === undefined ? 0 : missing).fill('0'), ...tailParts]
  return groups.map((group) => Number.parseInt(group, 16))
}

/**
 * The IPv4 address embedded in an IPv6 one, for the forms that route to it:
 * IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64
 * (64:ff9b::/96), 6to4 (2002::/16) and Teredo (2001::/32, obfuscated).
 */
function embeddedIpv4(groups: number[]): string | null {
  const v4 = (high: number, low: number) => [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
  const zeros = (from: number, to: number) => groups.slice(from, to).every((group) => group === 0)

  if (zeros(0, 5) && groups[5] === 0xffff) return v4(groups[6], groups[7])
  if (zeros(0, 6) && (groups[6] !== 0 || groups[7] > 1)) return v4(groups[6], groups[7])
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) return v4(groups[6], groups[7])
  if (groups[0] === 0x2002) return v4(groups[1], groups[2])
  if (groups[0] === 0x2001 && groups[1] === 0) return v4(groups[6] ^ 0xffff, groups[7] ^ 0xffff)
  return null
}

/**
 * True for any address a link must never resolve to. Unparseable input is
 * treated as blocked - this is a security check, so it fails closed.
 */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0]
  const version = isIP(bare)
  if (version === 4) {
    return BLOCKED.check(bare, 'ipv4')
  }
  if (version !== 6) {
    return true
  }
  if (BLOCKED.check(bare, 'ipv6')) {
    return true
  }
  const groups = ipv6Groups(bare.toLowerCase())
  if (!groups) {
    return true
  }
  const v4 = embeddedIpv4(groups)
  return v4 !== null && BLOCKED.check(v4, 'ipv4')
}
