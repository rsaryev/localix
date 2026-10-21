// Pure mapping from a `localix://resource/chat` resource-nav URI back to its NATIVE context-ref
// token. The composer drills the project → session → message tree through the
// shared `@resource:` machinery (one drill-down model), but LINKS each node as its
// first-class native ref (@project:/@session:/@message:) so the resulting pill,
// expander and dedup match the drag-minted refs exactly. Kept apart from the React
// hook so it's unit-testable.
//
// URI grammar (owned by the backend chat resource provider):
//   localix://resource/chat/project/<projectId>        → @project:<projectId>
//   localix://resource/chat/session/<sessionId>        → @session:<sessionId>
//   localix://resource/chat/message/<sessionId>/<mid>  → @message:<sessionId>/<mid>
//
// The `@`-token grammar itself is NOT spelled here — `refToken` (the registry-driven
// inverse in `@localixai/api/context-refs`) owns it, so this file only decides which
// kind + value a `localix://resource/chat` node maps to.

import { refToken } from '@localixai/api/context-refs'
import { parseLocalixResourceUri } from '@localixai/plugin-sdk/ui'

/** True for a resource URI owned by the chat-nav provider. */
export function isChatResourceUri(uri: string): boolean {
  return parseLocalixResourceUri(uri)?.provider === 'chat'
}

/**
 * Maps a `localix://resource/chat` URI to the native `@`-token it should link as (WITHOUT a
 * trailing space). Returns null for any non-chat or malformed URI, so the caller
 * falls back to the generic `@resource:` token.
 */
export function chatUriToNativeToken(uri: string): string | null {
  if (!isChatResourceUri(uri)) return null
  const parsed = parseLocalixResourceUri(uri)
  if (parsed?.provider !== 'chat') return null
  const segments = parsed.segments.map((segment) => decodeURIComponent(segment))
  const [kind, a, b] = segments
  if (kind === 'project' && a && segments.length === 2) return refToken('project', a)
  if (kind === 'session' && a && segments.length === 2) return refToken('session', a)
  if (kind === 'message' && a && b && segments.length === 3) return refToken('message', `${a}/${b}`)
  return null
}
