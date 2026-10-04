/**
 * The ONE redaction module for every surface that serializes workbench state outward —
 * journal records, ws-frames, tool result text, (later) watcher payloads.
 *
 * The lesson is Vibe-Trading's single strong one: per-surface redaction DRIFTS. Three
 * hand-rolled "strip the secrets" copies agree on the day they are written and diverge the
 * day one grows a field — and the surface that missed it is exactly the one that leaks. So
 * the marker list and the walk live HERE, once, and a surface that redacts calls this module
 * or it is not redacting.
 *
 * PURE: no fs, no service, no venue. Two primitives:
 *  - {@link redactValue} — deep-copy any JSON-ish value with every credential-shaped key's
 *    value replaced by {@link REDACTED} (matched by the credential FIELD NAMES this plugin
 *    persists plus the generic `*key*`/`*secret*`/`*token*`/`authorization` markers).
 *  - {@link stripSecretRefs} — remove `${secret:KEY}` tokens from free text. A reference is
 *    not the secret, but a tool result / error string has no business naming vault keys the
 *    model can then echo around.
 */
import { CREDENTIAL_FIELDS } from './contracts'

export const REDACTED = '[REDACTED]'

/**
 * Substring markers of a credential-bearing key, checked case-insensitively. `walletAddress`
 * and `uid` carry no marker substring, so the EXACT persisted credential field names ride
 * beside them — the plugin's own vocabulary is always covered even where a generic marker
 * would not catch it.
 */
const KEY_MARKERS = [
  'key',
  'secret',
  'token',
  'password',
  'passphrase',
  'credential',
  'authorization',
]
const EXACT_KEYS = new Set<string>(CREDENTIAL_FIELDS.map((f) => f.toLowerCase()))

/** Is `key` a name whose VALUE must never be serialized outward? */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return EXACT_KEYS.has(k) || KEY_MARKERS.some((m) => k.includes(m))
}

/** `${secret:KEY}` token — same grammar as the plugin-sdk interpolator. A fresh regex per
 *  call: a shared `/g` instance carries `lastIndex` state between calls. */
const secretRefRe = () => /\$\{secret:[A-Za-z0-9_.-]+\}/g

/** Remove `${secret:KEY}` tokens from free text (venue errors, tool results). */
export function stripSecretRefs(text: string): string {
  return text.replace(secretRefRe(), '[secret-ref]')
}

/**
 * A deep copy of `value` with every sensitive key's value replaced by {@link REDACTED}.
 * Traverses plain objects and arrays; primitives pass through; a cyclic object is cut with
 * `REDACTED` rather than recursing forever (a cycle in an outbound payload is already a bug —
 * this just refuses to turn it into a hang). Non-plain objects (class instances, functions)
 * are NOT walked: their serialization is not this module's contract, and a driver object
 * reaching an outbound surface should fail loudly there, not be laundered here.
 */
export function redactValue<T>(value: T): T {
  return walk(value, new Set()) as T
}

function walk(value: unknown, seen: Set<unknown>): unknown {
  if (typeof value === 'string') return stripSecretRefs(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return REDACTED
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((v) => walk(v, seen))
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      return value
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) && v != null ? REDACTED : walk(v, seen)
    }
    return out
  } finally {
    seen.delete(value)
  }
}
