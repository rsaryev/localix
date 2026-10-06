/**
 * Identity for an external coding-agent session.
 *
 * A native session id is only unique WITHIN its provider: Claude Code uses bare UUIDs, opencode
 * uses `ses_*`, Codex uses UUIDv7. Those namespaces are not coordinated with each other and will
 * collide eventually. Keying a link on the raw id alone produces silent cross-talk between
 * transcripts — the worst possible failure, because nothing errors. So the key is ALWAYS the pair.
 *
 * A normalized agent-history contract makes the same choice: `provider` is a first-class required
 * field on every session/event record and every citation. We use that shape.
 */

/** Stable provider handle. Must match a `ProviderAdapter.id` in the adapter registry. */
export type ProviderId = string

export interface ExternalSessionKey {
  readonly provider: ProviderId
  readonly nativeSessionId: string
}

/**
 * `:` is the separator because no provider we support puts one in a session id (verified: Claude
 * Code UUIDs, Codex UUIDv7, opencode `ses_<base62>`, Gemini CLI UUIDs). We still encode rather
 * than trust that, so an exotic id can never forge a different provider's key.
 */
const SEP = ':'

export function encodeKeyPart(value: string): string {
  return encodeURIComponent(value)
}

/** Canonical string form of the pair — the primary key everywhere (store, wire, UI row key). */
export function linkKeyOf(key: ExternalSessionKey): string {
  return `${encodeKeyPart(key.provider)}${SEP}${encodeKeyPart(key.nativeSessionId)}`
}

export function parseLinkKey(raw: string): ExternalSessionKey | null {
  const at = raw.indexOf(SEP)
  if (at <= 0 || at === raw.length - 1) return null
  try {
    const provider = decodeURIComponent(raw.slice(0, at))
    const nativeSessionId = decodeURIComponent(raw.slice(at + 1))
    if (!provider || !nativeSessionId) return null
    return { provider, nativeSessionId }
  } catch {
    // A malformed percent-escape is a malformed key, not a crash.
    return null
  }
}

export function sameKey(a: ExternalSessionKey, b: ExternalSessionKey): boolean {
  return a.provider === b.provider && a.nativeSessionId === b.nativeSessionId
}
