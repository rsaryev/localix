/**
 * FileTab's side channels: the grid's dirty dot, live LSP diagnostics, the format-on-save
 * runner, and the editor's live meaning published to the composer. Each is one effect with one
 * owner; FileTab only wires them.
 */
import { useEffect, useMemo, type RefObject } from 'react'
import { applyTextEdits, textDigest } from '@localixai/api/lsp-edits'
import { snippetMessageBindingDraft, type PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { useChatStore } from '@/features/chat/model/store'
import { useGridStore } from '@/features/workspace-grid/model'
import type { EditorDiagnostic, EditorTextSelection } from '@/shared/ui/code-editor/CodeEditor'
import { editorStateMessageBinding } from '../model/editorStateContext'
import { fileSelectionMessageBinding } from '../model/selectionContext'
import { toEditorDiagnostic } from './fileTabHelpers'
import type { FormatOnSaveRunner } from './useFileEditor'
import type { useFileLsp } from './useFileLsp'

/** Surface the unsaved-buffer state on the grid tab (dirty dot). Clear on unmount so a
 *  closed/remounted tab never leaves a stale dot behind. */
export function useTabDirtyMark(itemId: string | undefined, dirty: boolean): void {
  useEffect(() => {
    if (!itemId) return
    useGridStore.getState().setItemDirty(itemId, dirty)
    return () => {
      useGridStore.getState().setItemDirty(itemId, false)
    }
  }, [itemId, dirty])
}

/** Live LSP diagnostics for the open file, delivered via the `lsp.diagnostics` firehose event
 *  into the session store (keyed by the resolved absolute path). */
export function useFileDiagnostics(
  sessionId: string,
  editPath: string | null | undefined,
): EditorDiagnostic[] {
  const rawDiagnostics = useChatStore((s) => {
    if (!editPath) return undefined
    const sess = s.allSessions.find((x) => x.id === sessionId)
    return sess?.lspDiagnostics[editPath]
  })
  return useMemo<EditorDiagnostic[]>(
    () => (rawDiagnostics ? rawDiagnostics.map(toEditorDiagnostic) : []),
    [rawDiagnostics],
  )
}

/**
 * Keep the format-on-save runner current. When enabled, it asks the LSP formatter for edits to
 * the buffer being saved and applies them in memory, so the save writes the formatted text ONCE.
 * Edits computed for any other text (the digest disagrees) are ignored rather than spliced in.
 * Any miss/error resolves null so the save falls through to the text-cleaned buffer. Disabled →
 * null (no request ever fires).
 */
export function useFormatOnSaveRunner(
  runnerRef: RefObject<FormatOnSaveRunner | null>,
  enabled: boolean,
  formatSource: ReturnType<typeof useFileLsp>['formatSource'],
): void {
  useEffect(() => {
    runnerRef.current = enabled
      ? async (text) => {
          try {
            const edit = await formatSource()
            return edit && edit.digest === textDigest(text)
              ? applyTextEdits(text, edit.edits)
              : null
          } catch {
            return null
          }
        }
      : null
  }, [enabled, formatSource, runnerRef])
}

interface EditorMessageContextInput {
  publishMessageContext?: PublishMessageContext
  editPath: string | null | undefined
  path: string
  buffer: string
  dirty: boolean
  language: string
  caretLine: number | null
  diagnostics: EditorDiagnostic[]
  selection: EditorTextSelection | null
}

/**
 * A non-empty selection is the strongest live meaning of an editable tab: publish exactly those
 * bytes plus coordinates. Clearing it restores the dirty buffer snapshot (when needed) or the
 * tab's static saved-file binding.
 *
 * Beside whichever of those applies rides the editor state — the caret line and what the
 * language server reports (`editorStateContext.ts`) — so "fix this" names a line and the errors
 * on screen reach the agent without it re-deriving them. Keyed on the caret LINE: column moves
 * would republish on every arrow key for no change in meaning.
 */
export function useEditorMessageContext({
  publishMessageContext,
  editPath,
  path,
  buffer,
  dirty,
  language,
  caretLine,
  diagnostics,
  selection,
}: EditorMessageContextInput): void {
  const editorState = useMemo(
    () =>
      editPath
        ? editorStateMessageBinding({ path: editPath, cursorLine: caretLine, diagnostics })
        : null,
    [editPath, caretLine, diagnostics],
  )
  useEffect(() => {
    if (!publishMessageContext) return
    const state = editorState ? [editorState] : []
    if (selection && editPath) {
      publishMessageContext({
        strategy: 'replace',
        bindings: [
          fileSelectionMessageBinding({
            ...selection,
            path: editPath,
            language,
          }),
          ...state,
        ],
      })
      return
    }
    if (dirty) {
      publishMessageContext({
        strategy: 'replace',
        bindings: [
          snippetMessageBindingDraft({
            label: `Unsaved buffer · ${path}`,
            content: buffer,
            language,
          }),
          ...state,
        ],
      })
      return
    }
    publishMessageContext(state.length > 0 ? { strategy: 'append', bindings: state } : null)
  }, [buffer, dirty, editPath, editorState, language, path, publishMessageContext, selection])
}
