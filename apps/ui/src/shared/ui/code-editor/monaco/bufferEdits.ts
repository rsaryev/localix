import type * as Monaco from 'monaco-editor'
import { textDigest, type BufferEdit, type TextEditLike } from '@localixai/api/lsp-edits'
import type { MonacoApi } from './runtime'

/**
 * Language-server edits applied to the model the way a keystroke would be: through
 * `executeEdits`, so they land on the undo stack, keep the caret and markers where they
 * belong, and reach the host through the ordinary `onChange` (dirty dot, save, didChange).
 * Replacing the model's text instead would clear undo and jump the caret.
 */

export function monacoTextEdits(
  monaco: MonacoApi,
  edits: readonly TextEditLike[],
): Monaco.languages.TextEdit[] {
  return edits.map((edit) => ({
    range: new monaco.Range(
      edit.range.start.line + 1,
      edit.range.start.character + 1,
      edit.range.end.line + 1,
      edit.range.end.character + 1,
    ),
    text: edit.newText,
  }))
}

/** Whether `edit` was computed against exactly the text `model` holds now. */
export function bufferEditMatches(model: Monaco.editor.ITextModel, edit: BufferEdit): boolean {
  return textDigest(model.getValue()) === edit.digest
}

/**
 * Apply `edit` as one undoable step. Refuses (false) when the model's text is no longer the
 * text the ranges were computed against — splicing them into moved text is how a buffer gets
 * silently corrupted, and the requester reports the refusal instead.
 */
export function applyBufferEdit(
  monaco: MonacoApi,
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Monaco.editor.ITextModel,
  edit: BufferEdit,
): boolean {
  if (!bufferEditMatches(model, edit)) return false
  editor.pushUndoStop()
  editor.executeEdits(
    'localix.languageServer',
    monacoTextEdits(monaco, edit.edits).map((textEdit) => ({
      ...textEdit,
      forceMoveMarkers: true,
    })),
  )
  editor.pushUndoStop()
  return true
}
