/**
 * Structured-response NORMALIZATION — turn a raw model reply into validated
 * SAME-FILE edits, or `null`.
 *
 * The only accepted output is strict JSON: `{"edits":[…]}`. The parser remains
 * fail-safe per hunk, but it does not carry alternate wire formats.
 *
 * FAIL-SAFE PER HUNK (the silent-truncation defect class): a hunk with an
 * out-of-range span, a no-op, or an overlap with an earlier-listed hunk is DROPPED — never a partial or
 * broken edit; an empty survivor set resolves the whole prediction to `null`.
 *
 * Pure — unit-tested. Lines are 1-based inclusive.
 */

import { MAX_EDITS, type EditPrediction } from './contracts'
import { checkEdit, nextEditReplySchema, orderAndDedupeEdits, type EditRejection } from './validate'

/** Per-cause tally of hunks the reply lost, by the rule that refused each one. */
export type EditRejectionCounts = Partial<Record<EditRejection | 'schema', number>>

export interface ParsedNextEditReply {
  edits: EditPrediction[] | null
  /** Only causes that actually fired appear, so an all-clear reply reports nothing. */
  rejections: EditRejectionCounts
  /**
   * Hunks whose `replacement` echoed prompt scaffolding back — the inline cursor marker or
   * the leading line numbers — and had it stripped before the hunk was accepted.
   *
   * This is the price of marking the caret IN the text: the marker becomes something the
   * model can copy into its answer. Stripping makes that harmless, and this count is the only
   * way to know whether it is happening at all, since a stripped hunk is indistinguishable
   * from a clean one in the result.
   */
  scaffoldEchoes: number
}

/**
 * Parse a model reply into validated SAME-FILE edits against `fileContent` (`null` when none):
 * the canonical `{"edits":[…]}` object, optionally wrapped in a JSON fence, with up to
 * `MAX_EDITS` hunks. The parse plus the tally of what it refused.
 *
 * A dropped hunk is invisible in the result — a reply whose only hunk was mislocated is
 * indistinguishable from a model that returned nothing. Without this tally, changes to how the
 * request conveys position, such as an in-text cursor marker instead of prose coordinates, are
 * unfalsifiable because there is no rejection count to compare.
 */
export function parseNextEditReplyDetailed(raw: string, fileContent: string): ParsedNextEditReply {
  const rejections: EditRejectionCounts = {}
  const echoes = { count: 0 }
  const text = (raw ?? '').trim()
  if (!text || text === 'null') return { edits: null, rejections, scaffoldEchoes: 0 }
  const fileLines = fileContent.split('\n')
  const edits = parseJsonEdits(text, fileLines, rejections, echoes)
  if (!edits || edits.length === 0) return { edits: null, rejections, scaffoldEchoes: echoes.count }
  return { edits: orderAndDedupeEdits(edits), rejections, scaffoldEchoes: echoes.count }
}

/**
 * Read the canonical JSON reply. Each item is validated by `nextEditReplySchema`
 * then `makeEdit`; an invalid item is dropped without discarding valid siblings.
 */
function parseJsonEdits(
  text: string,
  fileLines: string[],
  rejections: EditRejectionCounts,
  echoes: { count: number },
): EditPrediction[] | null {
  const body = stripFence(text, 'json') ?? text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let value: unknown
  try {
    value = JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }

  if (!value || typeof value !== 'object' || !Array.isArray((value as { edits?: unknown }).edits)) {
    return null
  }
  const items = (value as { edits: unknown[] }).edits

  const out: EditPrediction[] = []
  for (const item of items.slice(0, MAX_EDITS)) {
    const parsed = nextEditReplySchema.safeParse(item)
    if (!parsed.success) {
      rejections.schema = (rejections.schema ?? 0) + 1
      continue // drop the bad hunk, keep the rest
    }
    const checked = checkEdit(
      fileLines,
      parsed.data.startLine,
      parsed.data.endLine,
      parsed.data.replacement,
    )
    if (checked.ok) {
      if (checked.stripped) echoes.count += 1
      out.push(checked.edit)
    } else rejections[checked.rejection] = (rejections[checked.rejection] ?? 0) + 1
  }
  return out
}

/** Strip a ```<lang> … ``` fence, returning its body, or null when no such fence. */
function stripFence(text: string, lang: string): string | null {
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'i')
  const m = text.match(re)
  return m ? m[1] : null
}
