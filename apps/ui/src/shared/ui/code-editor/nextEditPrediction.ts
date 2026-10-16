/**
 * Editor-independent DATA MODEL for Monaco inline edit predictions: anchoring, drift,
 * narrowing, hunk rotation, and the digest-keyed result cache.
 *
 * Deliberately NOT a lifecycle layer any more. A typed phase machine
 * (`nextEditPredictionState.ts`: disabled → idle → debouncing → collecting → queued →
 * requesting → validating → showing → applying, plus suppressed/cancelled/backoff/stale) and a
 * `createNextEditRunner` that drove it were removed, along with `decideNextEditAction` and an
 * injectable scheduler. None of it had a production caller: the live driver is
 * `monaco/editPrediction.ts`, which owns its own request generation, abort and narrowing, and
 * never touched any of it. Its docstring claimed "the driver ... uses this reducer as the
 * single, testable source of legal phase transitions" and that UI surfaces render the phase —
 * both were false, and ~450 lines of tests over the unused half made the tested code look like
 * the shipped code. If prediction status ever needs to be rendered, build it against the driver
 * that actually runs.
 */
import { createBoundedCache } from '@localixai/kit/lib'
import type { EditorSuggestion } from './types'
import { isSuggestionDrifted } from './suggestionDecorations'
export interface NextEditRequest {
  content: string
  cursorLine: number
  cursorColumn: number
  documentVersion: number
  documentDigest: string
  requestId: string
}

export type NextEditSource = (
  request: NextEditRequest,
  signal: AbortSignal,
) => Promise<EditorSuggestion[] | null>

/** What happened to a shown prediction. `requestId` joins it to the server's outcome event. */
export interface NextEditShownOutcome {
  requestId: string
  accepted: boolean
  /** Hunks in the bundle the user was offered. */
  hunks: number
}

export interface NextEditController {
  source?: NextEditSource
  current: EditorSuggestion[] | null
  onChange: (suggestions: EditorSuggestion[] | null) => void
  /**
   * Report whether a SHOWN prediction was taken. Optional so a host that does not care about
   * acceptance still compiles, but the editor host wires it: acceptance rate is the only direct
   * measure of suggestion quality, and without it the subsystem can only report how the model and
   * its guards behaved, never whether any of it helped.
   */
  onOutcome?: (outcome: NextEditShownOutcome) => void
}

export function shiftEditsAfterApply(
  edits: EditorSuggestion[],
  applied: Pick<EditorSuggestion, 'startLine' | 'endLine' | 'replacement'>,
): EditorSuggestion[] {
  const replacedLines = applied.endLine - applied.startLine + 1
  const replacementLines = (applied.replacement ?? '').split('\n').length
  const delta = replacementLines - replacedLines
  if (delta === 0) return edits
  return edits.map((edit) =>
    edit.startLine <= applied.endLine
      ? edit
      : {
          ...edit,
          startLine: edit.startLine + delta,
          endLine: edit.endLine + delta,
        },
  )
}

export function survivingEditsAfterApply(
  edits: EditorSuggestion[],
  applied: Pick<EditorSuggestion, 'startLine' | 'endLine' | 'replacement'>,
  liveContent: string,
): EditorSuggestion[] {
  const lines = liveContent.split('\n')
  return shiftEditsAfterApply(edits, applied).filter(
    (edit) =>
      !isSuggestionDrifted(lines, {
        startLine: edit.startLine,
        endLine: edit.endLine,
        original: edit.original,
      }),
  )
}

/** The minimum document surface a typed-through check needs. Monaco's model
 *  satisfies it; unit tests hand over a plain array. */
export interface NextEditDocumentView {
  lineCount: number
  lineContent(line: number): string
}

/**
 * Keep a hunk alive while the user types the prediction out by hand.
 *
 * A keystroke inside a hunk makes its `original` stop matching the buffer, so a
 * strict validity check discards the whole prediction — the user pays a fresh
 * model call for text we already know. Continue solves the equivalent problem
 * for ghost text with a longest-prefix cache lookup
 * (`core/autocomplete/util/AutocompleteLruCache.ts` `get()`): find the longest
 * cached prefix of the current buffer and return only the remaining suffix.
 *
 * The diff-shaped analogue is to re-anchor rather than re-fetch. Whenever the
 * hunk's region became a strict prefix of the replacement, the same replacement
 * still describes the intended end state, so only `original`/`endLine` move. The
 * longest such span wins: it represents the most typing already absorbed. A
 * region equal to the replacement means the user finished it, which is completion
 * rather than narrowing and returns null. Deletions qualify on the same rule —
 * what matters is that the buffer is a prefix of the target, not how it got there.
 */
export function narrowTypedThroughSuggestion(
  document: NextEditDocumentView,
  suggestion: EditorSuggestion,
): EditorSuggestion | null {
  const replacement = suggestion.replacement
  // A pure-deletion hunk has nothing to type through.
  if (!replacement) return null
  if (!Number.isInteger(suggestion.startLine) || suggestion.startLine < 1) return null
  const replacementSpan = replacement.split('\n').length
  let narrowed: EditorSuggestion | null = null
  const lines: string[] = []
  for (let span = 1; span <= replacementSpan; span++) {
    const endLine = suggestion.startLine + span - 1
    if (endLine > document.lineCount) break
    lines.push(document.lineContent(endLine))
    const region = lines.join('\n')
    if (region.length >= replacement.length) break
    if (replacement.startsWith(region)) {
      narrowed = { ...suggestion, endLine, original: region }
    }
  }
  return narrowed
}

export function rotateHunks(
  list: EditorSuggestion[],
  direction: 'next' | 'prev',
): EditorSuggestion[] {
  if (list.length <= 1) return list
  return direction === 'next'
    ? [...list.slice(1), list[0]]
    : [list[list.length - 1], ...list.slice(0, -1)]
}

const CACHE_CAPACITY = 8
const POSITIVE_CACHE_TTL_MS = 90_000
const NEGATIVE_CACHE_TTL_MS = 10_000

export function nextEditDocumentDigest(content: string): string {
  // Non-cryptographic cache/correlation key. Math.imul keeps this linear scan
  // cheap on large buffers; the previous BigInt FNV-64 blocked the UI for tens
  // of milliseconds per megabyte.
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${content.length}`
}

export function nextEditCacheKeyFromDigest(
  digest: string,
  cursorLine: number,
  cursorColumn: number,
): string {
  return `${digest}:${cursorLine}:${cursorColumn}`
}

export function createNextEditCache(now: () => number = Date.now) {
  const entries = createBoundedCache<
    string,
    { edits: EditorSuggestion[] | null; createdAt: number }
  >({ maxEntries: CACHE_CAPACITY })
  return {
    get(key: string): { edits: EditorSuggestion[] | null } | undefined {
      const entry = entries.get(key)
      if (!entry) return undefined
      const ttl = entry.edits ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS
      if (now() - entry.createdAt > ttl) {
        entries.delete(key)
        return undefined
      }
      return { edits: entry.edits ? entry.edits.map((edit) => ({ ...edit })) : null }
    },
    set(key: string, edits: EditorSuggestion[] | null): void {
      const normalized = edits?.length ? edits : null
      entries.set(key, {
        edits: normalized ? normalized.map((edit) => ({ ...edit })) : null,
        createdAt: now(),
      })
    },
  }
}
