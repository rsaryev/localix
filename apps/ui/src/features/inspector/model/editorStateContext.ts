import { snippetMessageBindingDraft } from '@localixai/plugin-sdk/ui'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'
import { formatDiagnosticSource, type EditorDiagnostic } from '@/shared/ui/code-editor/types'

/**
 * What the person is looking at in an open file, as one small context facet beside the file
 * itself: where the caret is and what the language server currently reports.
 *
 * The file tab used to publish either the selection or the unsaved buffer — never the caret
 * and never the problems. So "fix this" or "why is this red?" sent the whole file with no
 * hint of which line was meant, and the agent re-derived errors the editor was already
 * showing (or, before its first edit, never saw them at all). The facet carries the file's
 * path and the caret line as a location, so it lands in the prompt as
 * `--- @snippet:Editor · x.ts from /abs/x.ts:18 ---`.
 */

/** Problems listed at most — the agent reads the file (or asks) for the rest. */
const MAX_PROBLEMS = 20

export interface EditorStateInput {
  path: string
  /** 1-based caret line, or null before the editor reported one. */
  cursorLine: number | null
  diagnostics: readonly EditorDiagnostic[]
}

/** Errors and warnings only — hints (an unused import) are not what a question is about. */
function reportable(diagnostics: readonly EditorDiagnostic[]): EditorDiagnostic[] {
  return diagnostics
    .filter((d) => d.severity === 'error' || d.severity === 'warning')
    .sort((a, b) =>
      a.severity !== b.severity ? (a.severity === 'error' ? -1 : 1) : a.line - b.line,
    )
}

export function editorStateText(input: EditorStateInput): string | null {
  const problems = reportable(input.diagnostics)
  if (input.cursorLine === null && problems.length === 0) return null
  const lines: string[] = []
  if (input.cursorLine !== null) lines.push(`Caret: ${input.path}:${input.cursorLine}`)
  if (problems.length === 0) {
    lines.push('Problems: none reported by the language server.')
  } else {
    lines.push(`Problems (${problems.length}):`)
    for (const d of problems.slice(0, MAX_PROBLEMS)) {
      const rule = formatDiagnosticSource(d.source, d.code)
      lines.push(
        `- ${d.line + 1}:${d.character + 1} ${d.severity}${rule ? ` ${rule}` : ''}: ${d.message}`,
      )
    }
    if (problems.length > MAX_PROBLEMS) lines.push(`- … ${problems.length - MAX_PROBLEMS} more`)
  }
  return lines.join('\n')
}

/** The editor-state facet for a message, or null when there is nothing to say. */
export function editorStateMessageBinding(input: EditorStateInput) {
  const content = editorStateText(input)
  if (content === null) return null
  const draft = snippetMessageBindingDraft(
    { label: `Editor · ${baseName(input.path)}`, content, language: 'text' },
    'active-tab',
  )
  return {
    ...draft,
    target: {
      ...draft.target,
      attributes: {
        ...draft.target.attributes,
        path: input.path,
        ...(input.cursorLine !== null ? { startLine: input.cursorLine } : {}),
      },
    },
  }
}
