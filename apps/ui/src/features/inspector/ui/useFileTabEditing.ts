import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { recordEdit } from '@/features/inspector/model/editorActivity'
import type {
  CompletionSource,
  EditorContentChange,
  EditorHandle,
  EditorPosition,
} from '@/shared/ui/code-editor/CodeEditor'
import { primaryChangeLine } from '@/shared/ui/code-editor/contentSync'
import type { EditorRunContext, FileTabProps } from './fileTabProps'

interface FileTabEditingInput {
  buffer: string
  setBuffer: (value: string) => void
  editPath: string
  setCursorLine: (line: number) => void
  editorApiRef: MutableRefObject<EditorHandle | null>
  workItemVisible: boolean
  completionSource: CompletionSource | undefined
  auxCompletionSource: FileTabProps['auxCompletionSource']
  bindRunContext: FileTabProps['bindRunContext']
  onRun: FileTabProps['onRun']
}

/**
 * The buffer-side editor callbacks of a file tab: edit-history recording on change,
 * caret-line tracking, the aux-completion merge and the Run gesture's context.
 */
export function useFileTabEditing({
  buffer,
  setBuffer,
  editPath,
  setCursorLine,
  editorApiRef,
  workItemVisible,
  completionSource,
  auxCompletionSource,
  bindRunContext,
  onRun,
}: FileTabEditingInput) {
  // Feed the SAME-FILE edit-prediction history. recordEdit is a write-only hot path
  // (no re-render). The latest cursor line + buffer are kept in refs so an edit knows
  // where it happened without extra renders.
  const cursorLineRef = useRef(0)
  const bufferRef = useRef(buffer)
  useEffect(() => {
    bufferRef.current = buffer
  }, [buffer])
  const handleChange = useCallback(
    (value: string, changes?: readonly EditorContentChange[]) => {
      // bufferRef still holds the PRE-change content here (its effect runs post-render),
      // so it is the before→after diff baseline for the edit-history event.
      const prev = bufferRef.current
      setBuffer(value)
      // Where the edit happened comes from the change deltas the editor already carries:
      // the content event fires BEFORE the caret moves, so `cursorLineRef` still holds
      // the pre-edit line, and a multi-cursor edit reports several changes at once.
      // Programmatic callers (e.g. Convert Indentation) pass no deltas — fall back.
      if (editPath)
        recordEdit(editPath, prev, value, primaryChangeLine(changes) ?? cursorLineRef.current)
    },
    [setBuffer, editPath],
  )
  const handleCursorLine = useCallback(
    (line: number) => {
      cursorLineRef.current = line
      setCursorLine(line)
    },
    [setCursorLine],
  )

  // Language integration (SQL .sql files): layer a schema-aware completion source
  // ahead of the LSP one, injecting the live buffer so the aux source stays pure.
  const effectiveCompletionSource = useMemo<CompletionSource | undefined>(() => {
    if (!workItemVisible) return undefined
    if (!auxCompletionSource) return completionSource
    return async (pos: EditorPosition) => {
      const aux = await auxCompletionSource(bufferRef.current, pos)
      const lsp = completionSource ? await completionSource(pos).catch(() => []) : []
      return [...aux, ...lsp]
    }
  }, [workItemVisible, auxCompletionSource, completionSource])

  // Current editor run context (whole text + selection + caret) for the Run gesture.
  const getRunContext = useCallback<() => EditorRunContext>(
    () => ({
      fullText: bufferRef.current,
      selectedText: editorApiRef.current?.getSelectedText() ?? '',
      cursorOffset: editorApiRef.current?.getCursorOffset() ?? 0,
      formatDocument: () => editorApiRef.current?.formatDocument() ?? Promise.resolve(),
    }),
    [editorApiRef],
  )
  // Hand the getter to a docked panel (its Run button) once — getRunContext is stable.
  useEffect(() => {
    bindRunContext?.(getRunContext)
  }, [bindRunContext, getRunContext])
  const handleSubmit = useCallback(() => {
    onRun?.(getRunContext())
  }, [onRun, getRunContext])

  return { handleChange, handleCursorLine, effectiveCompletionSource, handleSubmit }
}
