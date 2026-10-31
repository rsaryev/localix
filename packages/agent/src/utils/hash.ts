/**
 * Universal hashing utilities — Web Crypto API only, no Node.js-specific imports.
 *
 * `globalThis.crypto.subtle` (Web Crypto) is available in Node 18+, all modern
 * browsers, Deno, and edge runtimes (Cloudflare Workers, Vercel Edge, etc.) with
 * no polyfills required. This keeps the library importable in any environment.
 *
 * Hashes are used for ephemeral cache-diagnostic snapshot keys compared within a
 * run; they are not persisted across restarts.
 */

/** Deterministic key-sorted JSON serialization (drops undefined OBJECT values). */
export function stableStringify(value: unknown): string {
  // `undefined` is special: JSON.stringify(undefined) returns the VALUE undefined,
  // not a string — which violates this function's `: string` contract and crashes
  // browserHash (`input.charCodeAt`). It also makes `[undefined]` collapse to `[]`
  // (a key collision). Serialize it as a stable token so the function is total.
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    // Code-unit order, not localeCompare: faster on the hot cache-key path and
    // locale-independent. For ASCII JSON keys (all keys here) the order is identical;
    // the keys are ephemeral within-run cache keys, never persisted, so even a
    // reordering of non-ASCII keys would be harmless.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`
}

interface RuntimeBuffer {
  byteLength(content: string, encoding: 'utf8'): number
}

// Node/Bun expose Buffer.byteLength which counts UTF-8 bytes without allocating
// an encoded copy; browsers fall back to a single module-level TextEncoder.
const runtimeBuffer = (globalThis as { Buffer?: RuntimeBuffer }).Buffer
const sharedTextEncoder = new TextEncoder()

/**
 * UTF-8 byte length of a string — Buffer.byteLength when available, TextEncoder otherwise. Both
 * count an unpaired surrogate as the three bytes of the U+FFFD it is encoded as.
 */
export function textEncoderByteLength(value: string): number {
  if (runtimeBuffer) return runtimeBuffer.byteLength(value, 'utf8')
  return sharedTextEncoder.encode(value).byteLength
}

/**
 * Synchronous 16-char hex hash of any value.
 * Objects are serialized with stableStringify for determinism.
 *
 * Uses FNV-1a (two interleaved 32-bit halves → 64-bit) — pure math, no platform
 * APIs, works in any runtime. For cache-diagnostic keys this is entirely sufficient;
 * cryptographic strength is not required.
 */
export function browserHash(value: unknown): string {
  const input = typeof value === 'string' ? value : stableStringify(value)
  let left = 0x811c9dc5
  let right = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    left ^= code
    right ^= code + i
    left = Math.imul(left, 0x01000193)
    right = Math.imul(right, 0x85ebca6b)
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`
}
