/**
 * Stable, collision-resistant cache-key construction for the L1 backend result cache
 * (plan §5/§6). The fingerprint is a SHA-256 over a CANONICAL serialization of every
 * input that can change the prediction — NOT djb2, and not the whole document scanned
 * per request (the document contributes only its precomputed digest).
 *
 * The NAMESPACE bakes the protocol / prompt / context-policy versions INTO the hashed
 * payload, so a version bump automatically invalidates every prior entry (no manual
 * cache flush at rollout). The returned key is prefixed with a short readable namespace
 * tag for diagnostics; the hash is the identity.
 */

import { createHash } from 'node:crypto'

/** Wire/protocol version — bumped when the request/response contract changes. */
export const CACHE_PROTOCOL_VERSION = 2
/** Context-policy version — bumped when Context Fabric policy/serialization changes. */
export const CONTEXT_POLICY_VERSION = 1
/**
 * Canonical prompt/schema version. There is no runtime prompt-version switch — this is a
 * CACHE-INVALIDATION counter, not a selector: bump it in the same change that alters the
 * prompt, so entries produced by the old wording can never be served against the new one.
 *
 * 3: the caret is marked inline (`CURSOR_MARKER`) instead of described as prose coordinates,
 * and the prompt now forbids reverting the developer's last change.
 */
export const EDIT_PREDICTION_SCHEMA_VERSION = 3

/** SHA-256 hex of a string. Not djb2: collision-resistant, fixed cost per digest. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Everything that must key a prediction. Optional fields serialize deterministically. */
export interface ResultCacheKeyParts {
  userId: string
  /** Canonical project scope (resolved server-side, never client filepath). */
  projectRoot?: string
  isolationId?: string
  /** Precomputed document content digest (never the full text). */
  documentDigest: string
  documentVersion?: number
  cursorLine: number
  cursorColumn?: number
  /** Selection ranges, if the client reports any (0-based positions). */
  selections?: Array<{ anchorLine: number; anchorCol: number; headLine: number; headCol: number }>
  /** Trigger class (typing/paste/undo/redo/manual). Defaults to `typing`. */
  triggerClass?: string
  /** Digest of the same-file edit history (from {@link editHistoryDigest}). */
  editHistoryDigest: string
  /** Digest capturing the resolved context contributions + rendered prompt payload. */
  contextFingerprint: string
  modelId: string
  providerConnectionId?: string | null
}

/**
 * Canonical, order-stable serialization → SHA-256 → namespaced key. Two semantically
 * identical requests produce the same key; any semantic difference (model, cursor,
 * edit history, resolved context, versions) produces a different one.
 */
export function buildResultCacheKey(parts: ResultCacheKeyParts): string {
  const canonical = JSON.stringify([
    'edit-prediction',
    CACHE_PROTOCOL_VERSION,
    CONTEXT_POLICY_VERSION,
    EDIT_PREDICTION_SCHEMA_VERSION,
    parts.userId,
    parts.projectRoot ?? '',
    parts.isolationId ?? '',
    parts.documentDigest,
    parts.documentVersion ?? 0,
    parts.cursorLine,
    parts.cursorColumn ?? 0,
    (parts.selections ?? []).map((s) => [s.anchorLine, s.anchorCol, s.headLine, s.headCol]),
    parts.triggerClass ?? 'typing',
    parts.editHistoryDigest,
    parts.contextFingerprint,
    parts.modelId,
    parts.providerConnectionId ?? '',
  ])
  return `ep${CACHE_PROTOCOL_VERSION}:s${EDIT_PREDICTION_SCHEMA_VERSION}:${sha256Hex(canonical)}`
}

/** Deterministic digest of the same-file edit-history windows. */
export function editHistoryDigest(
  ranges: ReadonlyArray<{
    before?: string[]
    lines: string[]
    startLine?: number
    endLine?: number
  }>,
): string {
  if (ranges.length === 0) return 'none'
  return sha256Hex(
    JSON.stringify(
      ranges.map((r) => [r.startLine ?? -1, r.endLine ?? -1, r.before ?? null, r.lines]),
    ),
  )
}
