/**
 * Pure builder for the `@session:<id>` context-ref expansion — a COMPACT,
 * token-economical digest of another chat session (title, status, and a bounded
 * tail of recent turns). It deliberately does
 * NOT inline a full transcript: the header points the agent at `global_search`
 * to read the linked session in depth only when it actually needs to.
 *
 * Kept free of DB / IO so the formatting + trimming rules stay unit-testable.
 * The data is loaded by the caller (bootstrap) from the chat repository and
 * mapped into `SessionDigestInput`.
 */

/** A single recent turn already reduced to plain text (chronological order). */
import { plural } from '../../lib/plural'

export interface DigestTurn {
  role: string
  text: string
}

export interface SessionDigestInput {
  /** The linked session's canonical id/ref, e.g. `LOCALIX-42`. */
  id: string
  title: string
  runtimeStatus: string
  messageCount: number
  /** ISO timestamp of the last activity. */
  updatedAt: string
  /** Recent user/assistant turns, oldest → newest (already the trimmed tail). */
  recentTurns: DigestTurn[]
}

/** Max turns shown in the digest tail. */
export const DIGEST_MAX_TURNS = 6
/** Max chars kept per turn (longer turns are ellipsized). */
export const DIGEST_PER_TURN_CHARS = 400

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max).trimEnd()}…` : s

const oneLineDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10)
}

function roleLabel(role: string): string {
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  return role || 'assistant'
}

/**
 * Renders the digest markdown block. Size stays in the low thousands of chars:
 * a header and up to `DIGEST_MAX_TURNS` trimmed turns, closed by a pointer to
 * `global_search` for deeper reads.
 */
export function buildSessionDigest(input: SessionDigestInput): string {
  const lines: string[] = []
  const title = input.title.trim() || '(untitled)'
  lines.push(`Session ${input.id} — "${title}"`)
  lines.push(
    `Status: ${input.runtimeStatus} · ${plural(input.messageCount, 'message')} · updated ${oneLineDate(input.updatedAt)}`,
  )

  const turns = input.recentTurns
    .flatMap((t) => {
      const text = t.text.replace(/\s+/g, ' ').trim()
      return text.length > 0 ? [{ role: t.role, text }] : []
    })
    .slice(-DIGEST_MAX_TURNS)

  if (turns.length > 0) {
    lines.push('')
    lines.push(`Recent turns (last ${turns.length}):`)
    for (const t of turns) {
      lines.push(`[${roleLabel(t.role)}] ${truncate(t.text, DIGEST_PER_TURN_CHARS)}`)
    }
  } else {
    lines.push('')
    lines.push('(No conversation content yet.)')
  }

  lines.push('')
  lines.push(
    `(Compact digest of the linked session. To read it in full, use the global_search tool with session_id "${input.id}".)`,
  )

  return lines.join('\n')
}
