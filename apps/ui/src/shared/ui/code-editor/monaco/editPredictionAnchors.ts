import type * as Monaco from 'monaco-editor'
import type { EditorSuggestion } from '../types'
import { narrowTypedThroughSuggestion } from '../nextEditPrediction'
import type { MonacoApi } from './runtime'

/** Turn an insertion exactly at the caret into ghost text; replacements remain native edits. */
export function caretInsertion(
  suggestion: EditorSuggestion,
  position: Monaco.Position,
): string | null {
  if (position.lineNumber < suggestion.startLine || position.lineNumber > suggestion.endLine)
    return null
  const lines = suggestion.original.split('\n')
  const line = position.lineNumber - suggestion.startLine
  if (position.column < 1 || position.column > lines[line]!.length + 1) return null
  const offset =
    lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0) + position.column - 1
  const before = suggestion.original.slice(0, offset)
  const after = suggestion.original.slice(offset)
  const replacement = suggestion.replacement ?? ''
  if (
    replacement.length <= suggestion.original.length ||
    !replacement.startsWith(before) ||
    !replacement.endsWith(after)
  )
    return null
  return replacement.slice(offset, replacement.length - after.length)
}

export function suggestionRange(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  suggestion: EditorSuggestion,
): Monaco.Range {
  return new monaco.Range(
    suggestion.startLine,
    1,
    suggestion.endLine,
    model.getLineMaxColumn(suggestion.endLine),
  )
}

export function isValidSuggestion(
  model: Monaco.editor.ITextModel,
  suggestion: EditorSuggestion,
): boolean {
  if (
    !Number.isInteger(suggestion.startLine) ||
    !Number.isInteger(suggestion.endLine) ||
    suggestion.startLine < 1 ||
    suggestion.endLine < suggestion.startLine ||
    suggestion.endLine > model.getLineCount()
  ) {
    return false
  }
  const lines: string[] = []
  for (let line = suggestion.startLine; line <= suggestion.endLine; line++) {
    lines.push(model.getLineContent(line))
  }
  return lines.join('\n') === suggestion.original
}

/**
 * Whether an edit landed on a line some hunk of the bundle covers (both in the
 * pre-edit coordinates Monaco reports a change in).
 *
 * A bundle only describes the next step of the text it was predicted for. Typing a
 * hunk out by hand lands on the hunk and keeps it alive (`narrowBundle`); an edit
 * anywhere else is a step the prediction never saw — deleting a type three lines
 * below it, say — and re-offering the old bundle instead of asking again is what made
 * the suggestion for the new hole never arrive.
 */
export function editTouchesBundle(
  changes: readonly { range: { startLineNumber: number; endLineNumber: number } }[],
  bundle: readonly EditorSuggestion[],
): boolean {
  return changes.some((change) =>
    bundle.some(
      (hunk) =>
        change.range.startLineNumber <= hunk.endLine &&
        change.range.endLineNumber >= hunk.startLine,
    ),
  )
}

/**
 * Re-anchor a whole bundle against the live buffer, keeping hunks the user is
 * typing out by hand. A bundle is all-or-nothing: one surviving hunk beside a
 * hunk that drifted (a line-count change shifts every hunk below it) would
 * preview edits the model never proposed together.
 */
export function narrowBundle(
  model: Monaco.editor.ITextModel,
  bundle: readonly EditorSuggestion[],
): EditorSuggestion[] | null {
  const view = {
    lineCount: model.getLineCount(),
    lineContent: (line: number) => model.getLineContent(line),
  }
  const narrowed: EditorSuggestion[] = []
  for (const suggestion of bundle) {
    if (isValidSuggestion(model, suggestion)) {
      narrowed.push(suggestion)
      continue
    }
    const next = narrowTypedThroughSuggestion(view, suggestion)
    if (!next) return null
    narrowed.push(next)
  }
  return narrowed.length > 0 ? narrowed : null
}
