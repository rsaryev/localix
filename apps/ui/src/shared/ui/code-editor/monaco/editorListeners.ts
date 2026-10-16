import type * as Monaco from 'monaco-editor'
import type { CodeEditorProps } from '../codeEditorProps'
import { toEditorContentChanges } from '../contentSync'
import { normalizeEditorSelection } from '../selection'
import { setWordWrap } from '../wordWrap'
import { setRenderWhitespace } from '../renderWhitespace'
import { setInlayHintsEnabled } from '../inlayHintsPref'
import { onBufferEdits } from '@/shared/lib/bufferEditBus'
import type { MonacoApi } from './runtime'
import { registerMonacoNativeEditing } from './nativeEditing'
import { applyBufferEdit } from './bufferEdits'
import { cursorStatus } from './editorOptions'

/** Mutable flags shared between the mounted editor and the component's prop effects. */
export interface EditorSyncRefs {
  /** True while the component pushes an external `value` into the model. */
  externalChange: { current: boolean }
  /** True while a host-driven scroll sync moves the editor (suppresses `onScroll`). */
  scrollGuard: { current: boolean }
  /**
   * Mirror of the model's exact text, or `null` when it cannot be trusted. Maintained
   * at the ONLY two places the model's content can change out from under it:
   *   - the content listener below, which already materializes the text for `onChange`
   *     (and drops the mirror when nobody did, so nothing is ever assumed);
   *   - the external-value effect, which drops it after pushing a new value in.
   * It exists so the echo guard can answer "does the model already hold `value`?"
   * without re-materializing the document on every keystroke.
   */
  modelText: { current: string | null }
}

/** Content, selection, scroll and option listeners that report editor state back to props. */
export function bindEditorListeners(input: {
  monaco: MonacoApi
  editor: Monaco.editor.IStandaloneCodeEditor
  model: Monaco.editor.ITextModel
  getProps: () => CodeEditorProps
  refs: EditorSyncRefs
  scheduleViewState: () => void
}): Monaco.IDisposable[] {
  const { monaco, editor, model, getProps, refs, scheduleViewState } = input

  const publishSelection = (selection: Monaco.Selection) => {
    const normalized = normalizeEditorSelection(
      {
        line: selection.selectionStartLineNumber,
        column: selection.selectionStartColumn,
      },
      {
        line: selection.positionLineNumber,
        column: selection.positionColumn,
      },
      model.getValueInRange(selection),
    )
    getProps().onSelectionChange?.(normalized)
  }

  return [
    registerMonacoNativeEditing(editor, () => getProps().readOnly ?? false),
    // A quick fix / rename for the file this editor holds arrives as edits for its buffer
    // (`bufferEditBus`), wherever it was requested from. Applied as one undoable step, or
    // refused when this buffer is no longer the text the edits were computed against.
    {
      dispose: onBufferEdits((edit) => {
        const current = getProps()
        if (!current.filePath || edit.file !== current.filePath || current.readOnly) {
          return false
        }
        return applyBufferEdit(monaco, editor, model, edit)
      }),
    },
    model.onDidChangeContent((event) => {
      if (!refs.externalChange.current) {
        const onChange = getProps().onChange
        if (onChange) {
          // The one full read of the document per keystroke: the host's buffer IS
          // the whole text (dirty check, save, formatting), so nothing smaller can
          // stand in for it. Everything else on this path works off the deltas.
          const text = model.getValue()
          refs.modelText.current = text
          onChange(text, toEditorContentChanges(event.changes))
        } else {
          // Nobody materialized the new text, so the mirror is stale from here on.
          refs.modelText.current = null
        }
      }
      const selection = editor.getSelection()
      if (selection) publishSelection(selection)
      scheduleViewState()
    }),
    editor.onDidChangeCursorSelection((event) => {
      const selection = event.selection
      const selectedChars = model.getValueInRange(selection).length
      const status = cursorStatus(selection)
      const props = getProps()
      props.onCursorLineChange?.(selection.positionLineNumber - 1)
      props.onCursorPositionChange?.({
        ...status,
        selectedChars,
      })
      publishSelection(selection)
      scheduleViewState()
    }),
    editor.onDidScrollChange((event) => {
      scheduleViewState()
      if (!event.scrollTopChanged || refs.scrollGuard.current) return
      const max = Math.max(editor.getScrollHeight() - editor.getLayoutInfo().height, 0)
      getProps().onScroll?.(max > 0 ? editor.getScrollTop() / max : 0)
    }),
    editor.onDidChangeConfiguration((event) => {
      if (event.hasChanged(monaco.editor.EditorOption.wordWrap)) {
        setWordWrap(editor.getOption(monaco.editor.EditorOption.wordWrap) !== 'off')
      }
      if (event.hasChanged(monaco.editor.EditorOption.renderWhitespace)) {
        setRenderWhitespace(
          editor.getOption(monaco.editor.EditorOption.renderWhitespace) !== 'none',
        )
      }
      if (event.hasChanged(monaco.editor.EditorOption.inlayHints)) {
        setInlayHintsEnabled(
          editor.getOption(monaco.editor.EditorOption.inlayHints).enabled !== 'off',
        )
      }
    }),
  ]
}
