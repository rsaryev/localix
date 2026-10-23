/**
 * Shared SSRF guard + bounded body reader for built-ins and native plugins.
 *
 * Pure, dependency-free (node:dns + node:net only): every fetch hop resolves its
 * host and is rejected when it points at a loopback / private / link-local
 * address, and the response body is streamed with a hard byte cap so a
 * model-supplied URL to a huge resource can't OOM the process.
 *
 * This module is part of the backend plugin contract so every model-supplied URL
 * crosses the same policy implementation. Hosts may re-export it for compatibility;
 * plugins must import it from `@localixai/plugin-sdk/backend`, never through host internals.
 */

import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

import { ipv6ToBytes, embeddedV4 } from './ip-literal'

/** Minimal fetch call surface for injectable HTTP clients (without runtime-specific static fields). */
export type HttpFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** True when an IPv4 address is loopback / private / link-local / unspecified. */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

/**
 * The IPv6 byte-decode (`ipv6ToBytes` + `embeddedV4`) is the stakes-NEUTRAL parsing
 * mechanism now shared with the preview dev-server detector via `../ip-literal` — see
 * that leaf's header. Only the mechanism is shared; the private-range POLICY below stays
 * this module's own copy (the guard over-includes; the detector may only widen toward it).
 */

/** True when an IPv6 address is loopback / unique-local / link-local / v4-mapped-private. */
export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  const bytes = ipv6ToBytes(ip)
  if (bytes) {
    if (bytes.every((b) => b === 0)) return true // :: unspecified
    if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true // ::1 loopback
    if ((bytes[0] & 0xfe) === 0xfc) return true // unique-local fc00::/7
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true // link-local fe80::/10
    const v4 = embeddedV4(bytes)
    if (v4 !== null) return isPrivateIPv4(v4)
    return false
  }
  // Unparseable (shouldn't happen for an isIP-validated literal): fall back to the
  // prior conservative string heuristics rather than silently calling it public.
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local fc00::/7
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  )
    return true // link-local fe80::/10
  const m = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (m) return isPrivateIPv4(m[1])
  return false
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return isPrivateIPv4(ip)
  if (family === 6) return isPrivateIPv6(ip)
  return false
}

/** Resolve a hostname to its IP addresses. Injectable so tests avoid real DNS. */
export type HostResolver = (host: string) => Promise<string[]>

const defaultResolver: HostResolver = async (host) => {
  const records = await dns.lookup(host, { all: true, verbatim: true })
  return records.map((r) => r.address)
}

/**
 * Resolve a URL's host and reject private/internal targets. Returns an error
 * string, or null when the host is safe to fetch. `resolve` is injectable for
 * tests (defaults to node:dns).
 */
export async function checkUrlSafety(
  parsed: URL,
  resolve: HostResolver = defaultResolver,
): Promise<string | null> {
  const host = parsed.hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return `Host "${host}" points at the local machine/network`
  }
  if (isIP(host)) {
    return isPrivateAddress(host) ? `IP ${host} is a private/internal address` : null
  }
  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    addresses = []
  }
  // Fail closed: the later fetch resolves the host again on its own, so a lookup that failed
  // here proves nothing about the address it will reach.
  if (addresses.length === 0) return `Host "${host}" could not be resolved for the safety check`
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      return `Host "${host}" resolves to private/internal address ${address}`
    }
  }
  return null
}

/**
 * Read a response body into text but STOP after `maxBytes`, to bound memory.
 * `res.text()` buffers an arbitrarily large response — a model-supplied URL to a
 * huge resource would OOM the process; a byte cap AFTER the full download is too
 * late. Streaming + a byte cap fixes that.
 */
/** A decoder for `label`, or a UTF-8 one when the runtime does not know it. */
function decoderFor(label: string | undefined): TextDecoder {
  if (!label) return new TextDecoder()
  try {
    return new TextDecoder(label)
  } catch {
    return new TextDecoder()
  }
}

export async function readBodyCapped(
  res: { body: ReadableStream<Uint8Array> | null; text: () => Promise<string> },
  maxBytes: number,
  /**
   * Charset label to decode with. Omitted means UTF-8, which is what this always did — so every
   * existing caller keeps its exact behaviour. An unsupported label falls back to UTF-8 rather than
   * throwing: `new TextDecoder('windows-1251')` raises `RangeError`, and a caller that passed a
   * charset straight off a `Content-Type` header would otherwise turn a garbled body into a failed
   * request. Deciding whether to WARN about that is the caller's, not this function's.
   */
  charset?: string,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!res.body) {
    const text = await res.text()
    return { text, bytes: Buffer.byteLength(text), truncated: false }
  }
  const reader = res.body.getReader()
  const decoder = decoderFor(charset)
  let text = ''
  let bytes = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    if (bytes + value.byteLength > maxBytes) {
      text += decoder.decode(value.subarray(0, maxBytes - bytes), { stream: true })
      bytes = maxBytes
      truncated = true
      await reader.cancel()
      break
    }
    bytes += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return { text, bytes, truncated }
}
