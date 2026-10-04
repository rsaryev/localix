import type * as Monaco from 'monaco-editor'
import { isSuggestionDrifted } from './suggestionDecorations'
import { survivingEditsAfterApply } from './nextEditPrediction'
import type { EditorSuggestion } from './types'
import type { MonacoApi } from './monaco/runtime'

export interface EditorHandle {
  revealLine: (line: number) => void
  getSelectedText: () => string
  getCursorOffset: () => number
  setText: (text: string) => void
  formatDocument: () => Promise<void>
  getScrollState: () => { percent: number }
  acceptNextEdit: (hunk?: EditorSuggestion) => void
  acceptSuggestion: (suggestion: EditorSuggestion) => void
}

export interface EditorHandleSources {
  nextEdit?: EditorSuggestion[] | null
  onNextEdit?: (suggestions: EditorSuggestion[] | null) => void
}

function suggestionRange(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  suggestion: EditorSuggestion,
): Monaco.Range {
  const start = Math.min(Math.max(suggestion.startLine, 1), model.getLineCount())
  const end = Math.min(Math.max(suggestion.endLine, start), model.getLineCount())
  return new monaco.Range(start, 1, end, model.getLineMaxColumn(end))
}

export function createEditorHandle(
  monaco: MonacoApi,
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Monaco.editor.ITextModel,
  getSources: () => EditorHandleSources,
  flashLine?: (lineNumber: number) => void,
): EditorHandle {
  const apply = (suggestion: EditorSuggestion): boolean => {
    if (isSuggestionDrifted(model.getLinesContent(), suggestion)) return false
    const range = suggestionRange(monaco, model, suggestion)
    editor.pushUndoStop()
    editor.executeEdits('localix.inlineEdit', [
      { range, text: suggestion.replacement ?? '', forceMoveMarkers: true },
    ])
    const end = model.getPositionAt(
      model.getOffsetAt(range.getStartPosition()) + (suggestion.replacement ?? '').length,
    )
    editor.setPosition(end)
    editor.pushUndoStop()
    editor.focus()
    return true
  }

  return {
    revealLine(line) {
      const lineNumber = Math.min(Math.max(line + 1, 1), model.getLineCount())
      editor.setPosition({ lineNumber, column: 1 })
      editor.revealLineInCenter(lineNumber, monaco.editor.ScrollType.Smooth)
      flashLine?.(lineNumber)
      editor.focus()
    },
    getSelectedText() {
      const selected: string[] = []
      for (const selection of editor.getSelections() ?? []) {
        if (!selection.isEmpty()) selected.push(model.getValueInRange(selection))
      }
      return selected.join('\n')
    },
    getCursorOffset() {
      return model.getOffsetAt(editor.getPosition() ?? new monaco.Position(1, 1))
    },
    setText(text) {
      editor.pushUndoStop()
      editor.executeEdits('localix.setText', [
        { range: model.getFullModelRange(), text, forceMoveMarkers: true },
      ])
      editor.pushUndoStop()
      editor.focus()
    },
    async formatDocument() {
      await editor.getAction('editor.action.formatDocument')?.run()
      editor.focus()
    },
    getScrollState() {
      const max = Math.max(editor.getScrollHeight() - editor.getLayoutInfo().height, 0)
      return { percent: max > 0 ? editor.getScrollTop() / max : 0 }
    },
    acceptNextEdit(hunk) {
      const { nextEdit, onNextEdit } = getSources()
      const target = hunk ?? nextEdit?.[0]
      if (!target || !nextEdit || !apply(target)) return
      const rest = survivingEditsAfterApply(
        nextEdit.filter((suggestion) => suggestion.id !== target.id),
        target,
        model.getValue(),
      )
      onNextEdit?.(rest.length ? rest : null)
    },
    acceptSuggestion(suggestion) {
      apply(suggestion)
    },
  }
}
