/**
 * Pure IPv6-literal parsing — the stakes-NEUTRAL mechanism shared by the SSRF guard
 * (`net-safety.ts`) and host-side URL classifiers such as the preview dev-server detector.
 *
 * Those two modules deliberately keep SEPARATE copies of their private-range POLICY
 * (which ranges count as private) under opposite stakes — the guard over-includes
 * forever, the detector may only be widened toward it, and a runtime ratchet
 * (`served-url-detect.net-safety-parity.test.ts`) pins that one-way relation. That
 * invariant is about the POLICY predicate, not about how an IPv6 string becomes bytes.
 *
 * Decoding a literal to its 16 bytes (with `::` zero-compression, a trailing embedded
 * dotted-quad, and embedded-v4 detection across v4-mapped / v4-compatible / NAT64) is
 * pure parsing with no stakes asymmetry — both sides want IDENTICAL decoding. Sharing
 * it in the backend SDK gives built-ins and native mini apps one neutral mechanism while
 * keeping their higher-level policy decisions explicit.
 */

/**
 * Decode an IPv6 literal to its 16 bytes, or null when it isn't one. Handles `::`
 * zero-compression and a trailing embedded dotted-quad (`::ffff:1.2.3.4`). We decode
 * to bytes so an embedded IPv4 is caught in EVERY spelling — hex (`::ffff:7f00:1`),
 * full-form (`0:0:0:0:0:ffff:7f00:1`), and NAT64 (`64:ff9b::7f00:1`) — not only the
 * dotted-quad form a string regex could see.
 */
export function ipv6ToBytes(ip: string): number[] | null {
  let s = ip.toLowerCase().trim()
  const zone = s.indexOf('%')
  if (zone !== -1) s = s.slice(0, zone) // strip a zone id (fe80::1%eth0)
  const halves = s.split('::')
  if (halves.length > 2) return null
  const side = (part: string): string[] => (part === '' ? [] : part.split(':'))
  let head = side(halves[0])
  let tail = halves.length === 2 ? side(halves[1]) : null

  // A dotted-quad, when present, is the final group of the whole address.
  const expandTail = (groups: string[]): string[] | null => {
    if (groups.length === 0) return groups
    const last = groups[groups.length - 1]
    if (!last.includes('.')) return groups
    const quad = last.split('.')
    if (quad.length !== 4) return null
    const n = quad.map((q) => Number(q))
    if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null
    const hi = ((n[0] << 8) | n[1]).toString(16)
    const lo = ((n[2] << 8) | n[3]).toString(16)
    return [...groups.slice(0, -1), hi, lo]
  }
  if (tail !== null) {
    const e = expandTail(tail)
    if (e === null) return null
    tail = e
  } else {
    const e = expandTail(head)
    if (e === null) return null
    head = e
  }

  let hextets: string[]
  if (tail === null) {
    hextets = head
  } else {
    const fill = 8 - head.length - tail.length
    if (fill < 0) return null
    hextets = [...head, ...Array<string>(fill).fill('0'), ...tail]
  }
  if (hextets.length !== 8) return null
  const bytes: number[] = []
  for (const h of hextets) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null
    const v = Number.parseInt(h, 16)
    bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  return bytes
}

/** The last 4 bytes as a dotted-quad when `bytes` embeds an IPv4 (v4-mapped
 *  `::ffff:0:0/96`, v4-compatible `::/96`, or NAT64 `64:ff9b::/96`), else null. */
export function embeddedV4(bytes: number[]): string | null {
  const zero = (from: number, to: number): boolean => bytes.slice(from, to).every((b) => b === 0)
  const quad = (): string => bytes.slice(12).join('.')
  if (zero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return quad() // v4-mapped ::ffff:0:0/96
  if (zero(0, 12)) return quad() // v4-compatible ::/96 (incl. ::a.b.c.d)
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zero(4, 12)
  )
    return quad() // NAT64 64:ff9b::/96
  return null
}
