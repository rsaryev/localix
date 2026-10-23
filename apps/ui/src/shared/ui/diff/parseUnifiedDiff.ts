import { parsePatch } from 'diff'

export type DiffLineType = 'add' | 'del' | 'ctx' | 'meta'

export interface DiffLine {
  type: DiffLineType
  /** Old-file line number (context + deletions). */
  oldNo?: number
  /** New-file line number (context + additions). */
  newNo?: number
  /** Line content without the leading +/-/space marker. */
  text: string
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

/**
 * Best-effort line-typing for input that isn't a valid unified diff — e.g. a V4A
 * patch body from a historical `apply_patch` item (its `@@` markers carry no line ranges
 * and are stripped before we get here) or a mid-stream fragment. Numbers the lines sequentially from 1 so
 * the gutter still reads as line numbers instead of two empty columns: additions
 * advance only the new side, deletions only the old side, context advances both.
 */
function fallback(diffText: string): DiffHunk[] {
  if (diffText === '') return [{ header: '', lines: [] }]
  let oldNo = 1
  let newNo = 1
  const lines = diffText.split('\n').map((l): DiffLine => {
    if (l.startsWith('+')) return { type: 'add', newNo: newNo++, text: l.slice(1) }
    if (l.startsWith('-')) return { type: 'del', oldNo: oldNo++, text: l.slice(1) }
    return { type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: l.startsWith(' ') ? l.slice(1) : l }
  })
  return [{ header: '', lines }]
}

/**
 * Parse unified-diff text into structured hunks with old/new line numbers.
 * Wraps the `diff` package's parsePatch; falls back to naive +/- typing for
 * fragments that aren't a complete patch. Shared by the inline preview and the
 * full inspector diff view so both render identically.
 */
export function parseUnifiedDiff(diffText: string): DiffHunk[] {
  try {
    const parsed = parsePatch(diffText)[0]
    if (!parsed?.hunks.length) return fallback(diffText)
    return parsed.hunks.map((h) => {
      let oldNo = h.oldStart
      let newNo = h.newStart
      const lines: DiffLine[] = h.lines.map((raw): DiffLine => {
        const marker = raw[0]
        const text = raw.slice(1)
        if (marker === '+') return { type: 'add', newNo: newNo++, text }
        if (marker === '-') return { type: 'del', oldNo: oldNo++, text }
        if (marker === '\\') return { type: 'meta', text: raw } // "\ No newline at end of file"
        return { type: 'ctx', oldNo: oldNo++, newNo: newNo++, text }
      })
      return { header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, lines }
    })
  } catch {
    return fallback(diffText)
  }
}

/**
 * New-file line where a diff's changes begin — so an "Open file" action can land
 * on the change instead of the top of the file. First added line, else the first
 * line carrying a new-file number. Returns `undefined` for an all-deletion or
 * empty diff (nothing to land on in the new file).
 */
export function firstChangedLine(diffText: string): number | undefined {
  for (const hunk of parseUnifiedDiff(diffText)) {
    const added = hunk.lines.find((l) => l.type === 'add' && l.newNo)
    if (added) return added.newNo
    const anyNew = hunk.lines.find((l) => l.newNo)
    if (anyNew) return anyNew.newNo
  }
  return undefined
}

// Kept as a re-export for the established `@/shared/ui/diff` public API. The
// implementation lives with the editor language registry so path detection and
// the selectable editor language modes stay aligned.
export { languageFromPath } from '../code-editor/language'
