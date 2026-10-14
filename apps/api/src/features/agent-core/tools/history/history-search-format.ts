import type { HistoryMessageRow } from '../../../chat/repository'

export type HistorySearchMode = 'discovery' | 'scroll' | 'browse'

/** A truncated message in a discovery window / bookend or scroll page. */
export interface HistoryMessagePreview {
  id: string
  role: string
  text: string
}

export interface HistorySessionResult {
  sessionId: string
  title: string
  createdAt: string
  lastMessageAt: string
  snippets: string[]
  /** ±2 messages around the best FTS hit. */
  matchWindow: HistoryMessagePreview[]
  /** First 2 user/assistant messages of the session. */
  start: HistoryMessagePreview[]
  /** Last 2 user/assistant messages of the session (omitting overlap with start/window). */
  end: HistoryMessagePreview[]
}

export interface HistorySearchDetails {
  mode: HistorySearchMode
  query?: string
  sessionId?: string
  userId: string
  count: number
}

// ---- discovery / scroll / browse tunables ----------------------------------------

export const DISCOVERY_DEFAULT_SESSIONS = 5
export const DISCOVERY_MAX_SESSIONS = 10
export const DISCOVERY_SNIPPETS_PER_SESSION = 2
export const DISCOVERY_WINDOW = 2
export const DISCOVERY_BOOKEND_COUNT = 2
export const DISCOVERY_PREVIEW_CHARS = 200
export const SCROLL_DEFAULT_WINDOW = 5
export const SCROLL_PREVIEW_CHARS = 500
export const BROWSE_DEFAULT_SESSIONS = 10
export const BROWSE_PREVIEW_CHARS = 150

// ---- text extraction / truncation helpers ----------------------------------------

/**
 * Turn arbitrary user text into a safe FTS5 MATCH expression. Raw input is passed straight to
 * `MATCH` otherwise, so any FTS5 metacharacter (`#`, `"`, `^`, `:`, `(`, `-`, `*`, AND/OR/NOT …)
 * raises "fts5: syntax error near …" and the whole search fails. We split on whitespace, drop
 * tokens with no letters/digits, and wrap each remaining token as a quoted phrase (doubling is
 * unnecessary since embedded quotes are stripped). Quoted tokens are implicitly ANDed by FTS5,
 * preserving search intent while making any input valid. Returns '' when nothing is searchable.
 */
export function toFtsMatchQuery(raw: string): string {
  return raw
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .map((t) => `"${t}"`)
    .join(' ')
}

/** Best-effort plain text from a stored message payload (content string or text items). */
export function extractMessageText(payloadJson: string): string {
  try {
    const p = JSON.parse(payloadJson) as {
      content?: unknown
      items?: Array<{ type?: string; text?: string } | null>
    }
    if (typeof p.content === 'string' && p.content.length > 0) return p.content
    if (Array.isArray(p.items)) {
      return p.items
        .filter(
          (i): i is { type: string; text: string } =>
            !!i && i.type === 'text' && typeof i.text === 'string',
        )
        .map((i) => i.text)
        .join(' ')
    }
    return ''
  } catch {
    return ''
  }
}

export const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max)}…` : s

export const toPreview = (row: HistoryMessageRow, max: number): HistoryMessagePreview => ({
  id: row.id,
  role: row.role,
  text: truncate(extractMessageText(row.payloadJson).replace(/\s+/g, ' ').trim(), max),
})

/** Total output budget (chars) for the model-facing JSON. */
const MAX_OUTPUT_CHARS = 8192

/**
 * Serialize compactly under the ~8KB budget. Discovery payloads degrade gracefully:
 * drop bookends first, then match windows, then whole trailing SESSIONS — each step
 * still emits VALID JSON, and a dropped session is COUNTED in `omittedSessions`.
 *
 * The old last step hard-sliced the JSON string mid-token and appended `…`, handing the
 * model an unparseable payload with nothing saying it had been cut. Silent truncation
 * reads as "these are all the results".
 */
export function capJson(payload: Record<string, unknown>): string {
  let text = JSON.stringify(payload)
  if (text.length <= MAX_OUTPUT_CHARS) return text
  const sessions = payload.sessions
  if (Array.isArray(sessions)) {
    for (const strip of [['start', 'end'], ['matchWindow']] as const) {
      for (const s of sessions) {
        if (s && typeof s === 'object')
          for (const key of strip) delete (s as Record<string, unknown>)[key]
      }
      text = JSON.stringify(payload)
      if (text.length <= MAX_OUTPUT_CHARS) return text
    }
    let omitted = 0
    while (sessions.length > 1 && text.length > MAX_OUTPUT_CHARS) {
      sessions.pop()
      omitted += 1
      payload.omittedSessions = omitted
      payload.note = `${omitted} more matching session(s) omitted to fit the output budget — narrow the query to see them`
      text = JSON.stringify(payload)
    }
    if (text.length <= MAX_OUTPUT_CHARS) return text
  }
  // A single result that alone blows the budget: say so instead of emitting a JSON
  // fragment the model will try to parse.
  return JSON.stringify({
    truncated: true,
    note: `The result exceeded the ${MAX_OUTPUT_CHARS}-char output budget and could not be shown. Narrow the query.`,
  })
}
