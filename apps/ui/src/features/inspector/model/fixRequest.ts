import { formatDiagnosticSource, type EditorDiagnostic } from '@/shared/ui/code-editor/types'

/**
 * The message "Fix with Agent" sends for one diagnostic.
 *
 * It used to be `path:line`, the message, and the offending line trimmed into an unlabelled
 * fence — so the agent got no column (which token?), no rule code, no neighbouring lines
 * (a missing import or a wrong type three lines up), no language on the fence, and a
 * DISPLAY path it then had to resolve. Everything below is already in the editor, so the
 * agent should not have to re-read the file to learn it:
 *
 *   - the exact location, `abs/path:line:column`, the form every tool and the editor opens;
 *   - the rule as `source(code)` — `ts(2304)` — the same label the Problems panel shows;
 *   - a numbered window around the range with a caret under the flagged span, fenced in
 *     the file's language;
 *   - the other problems inside that window, because they are usually the same fix.
 */

/** Lines shown above and below the flagged range. */
const CONTEXT_LINES = 3
/** A range taller than this is shown by its first lines only — the agent reads the file. */
const MAX_RANGE_LINES = 8

export interface FixRequestInput {
  diagnostic: EditorDiagnostic
  /** Resolved absolute path of the open file. */
  path: string
  /** The live buffer the diagnostic was reported against. */
  text: string
  /** Fence language (`typescript`, `python`, …); empty for plain text. */
  language: string
  /** Every diagnostic currently on the file — neighbours inside the window are listed. */
  diagnostics?: readonly EditorDiagnostic[]
}

export function buildFixRequest(input: FixRequestInput): string {
  const { diagnostic: d, path, text, language } = input
  const lines = text.split('\n')
  const rule = formatDiagnosticSource(d.source, d.code)
  const location = `${path}:${d.line + 1}:${d.character + 1}`

  const from = Math.max(0, d.line - CONTEXT_LINES)
  const lastFlagged = Math.min(d.endLine, d.line + MAX_RANGE_LINES - 1)
  const to = Math.min(lines.length - 1, lastFlagged + CONTEXT_LINES)
  const width = String(to + 1).length
  const window: string[] = []
  for (let index = from; index <= to; index++) {
    const content = lines[index] ?? ''
    window.push(`${String(index + 1).padStart(width)} | ${content}`)
    // A caret line under a single-line span says WHICH token, not just which line.
    if (index === d.line && d.endLine === d.line && d.endCharacter > d.character) {
      const pad = ' '.repeat(width) + ' | ' + ' '.repeat(d.character)
      window.push(`${pad}${'^'.repeat(d.endCharacter - d.character)}`)
    }
  }

  const neighbours = (input.diagnostics ?? []).filter(
    (other) =>
      other !== d &&
      other.severity !== 'hint' &&
      other.line >= from &&
      other.line <= to &&
      !(other.line === d.line && other.character === d.character && other.message === d.message),
  )

  const parts = [
    `Fix this ${d.severity} at \`${location}\`${rule ? ` — ${rule}` : ''}:`,
    '',
    d.message,
    '',
    '```' + language,
    ...window,
    '```',
  ]
  if (neighbours.length > 0) {
    parts.push('', 'Also reported nearby:')
    for (const other of neighbours) {
      const otherRule = formatDiagnosticSource(other.source, other.code)
      parts.push(
        `- line ${other.line + 1}:${other.character + 1} ${other.severity}${otherRule ? ` ${otherRule}` : ''}: ${other.message}`,
      )
    }
  }
  return parts.join('\n') + '\n'
}
