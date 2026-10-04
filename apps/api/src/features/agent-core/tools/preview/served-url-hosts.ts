/**
 * WHICH HOSTS A DEV-SERVER BANNER MAY OPEN, and how they rank against each other.
 *
 * Split from the detector because it answers a different question. The detector asks
 * "which URL did this output advertise"; this module asks "is that host ours to open" —
 * loopback and private LAN are, a public IP is not, a DNS name is trusted only with a real
 * local listener behind it. The bind-all addresses (`0.0.0.0`, `::`) are the case worth
 * stating: both mean "every interface" and both answer at `localhost`, so both are
 * loopback here and rewritten by the detector rather than dropped.
 *
 * The private-range tests mirror `lib/ssrf-guard`'s: `served-url-detect.net-safety-parity`
 * proves every address the guard calls private is non-public here, so the preview never
 * opens a banner the guard would refuse to fetch.
 */
import { ipv6ToBytes, embeddedV4 } from '../ip-literal'

export type HostKind = 'custom' | 'loopback' | 'private-ip' | 'public-ip'

function isIpv4(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/**
 * RFC 1122 loopback is the WHOLE `127.0.0.0/8`, not just `127.0.0.1` — a dev server
 * bound to `127.0.0.2` (a common trick for running several apps on one port) is
 * exactly as local, and was previously classified `public-ip` and therefore never
 * auto-detected.
 */
function isLoopbackIpv4(value: string): boolean {
  return Number(value.split('.', 1)[0]) === 127
}

/**
 * Non-loopback ranges that are still LOCAL (a LAN/interface address a dev server may
 * advertise), so the detector may open them.
 *
 * This list is deliberately a SEPARATE copy from the SSRF guard's
 * (`tools/web/net-safety.ts` `isPrivateIPv4`) — see the module header for why. The
 * relation between them is one-way and enforced at runtime by
 * `served-url-detect.net-safety-parity.test.ts`: anything the GUARD calls private must
 * be non-public HERE. Widening this list is always safe; the guard must never be
 * narrowed to match it.
 */
function isPrivateIpv4(value: string): boolean {
  const [a, b] = value.split('.').map(Number)
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    a === 0 // 0.0.0.0/8 "this network" (0.0.0.0 itself is handled as loopback)
  )
}

function isIpv6(value: string): boolean {
  return value.includes(':') && /^[0-9a-f:]+$/.test(value)
}

/**
 * Non-public IPv6: unique-local (`fc00::/7`), link-local (`fe80::/10`), or a
 * v4-mapped/v4-compatible/NAT64 address whose EMBEDDED IPv4 is loopback/private. The
 * embedded-v4 cases need a real byte decode — a prefix heuristic can't see a hex-form
 * v4-mapped loopback (`::ffff:7f00:1`) or NAT64 (`64:ff9b::…`), which then classified as
 * `public-ip` and a private dev-server advertised in that form went undetected. The
 * decoder is the SAME stakes-neutral `../ip-literal` mechanism the SSRF guard uses; the
 * loopback/private classification below is the detector's OWN policy (see the module
 * header + the net-safety-parity ratchet). Dotted-embedded forms (`::ffff:10.0.0.1`)
 * never reach here — `isIpv6` rejects the dots — and fall through to `custom`.
 */
function isPrivateIpv6(value: string): boolean {
  const bytes = ipv6ToBytes(value)
  if (bytes) {
    if ((bytes[0] & 0xfe) === 0xfc) return true // unique-local fc00::/7
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true // link-local fe80::/10
    const v4 = embeddedV4(bytes)
    if (v4 !== null) return isLoopbackIpv4(v4) || isPrivateIpv4(v4)
    return false
  }
  // Unparseable (shouldn't happen for a `[0-9a-f:]`-only literal): keep the prior
  // conservative prefix heuristic rather than silently calling it public.
  if (value.startsWith('fc') || value.startsWith('fd')) return true
  const firstHextet = Number.parseInt(value.split(':', 1)[0], 16)
  return Number.isFinite(firstHextet) && (firstHextet & 0xffc0) === 0xfe80
}

/**
 * A host that is not an address at all (`*`) is not browsable as written and is rejected.
 * The two bind-all addresses are NOT in this set: `0.0.0.0` and `::` both mean "every
 * interface", and a server bound to either answers at `localhost`, so they are normalized
 * rather than dropped. `::` used to be rejected here, and Python's `http.server` on macOS
 * prints exactly `http://[::]:4173/` — the one banner a great many agent-started servers
 * emit was the one the detector never latched.
 */
export function isUnspecifiedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return h === '*'
}

export function classifyHost(hostname: string): HostKind {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '') // URL.hostname brackets IPv6
  // `0.0.0.0` / `::` bind all interfaces but are reached at localhost → treat as loopback
  // (toOpenable rewrites the host); without this they'd classify as public/unspecified.
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::') return 'loopback'
  if (isIpv4(h))
    return isLoopbackIpv4(h) ? 'loopback' : isPrivateIpv4(h) ? 'private-ip' : 'public-ip'
  if (isIpv6(h)) return isPrivateIpv6(h) ? 'private-ip' : 'public-ip'
  return 'custom' // a DNS name — almost always the one the user wants opened
}

// custom DNS > loopback > private IP > public IP (a configured host like
// `local.app.test` is usually intended; loopback beats LAN for cert/cookie reasons).
export function hostKindScore(kind: HostKind): number {
  return kind === 'custom' ? 3 : kind === 'loopback' ? 2 : kind === 'private-ip' ? 1 : 0
}
