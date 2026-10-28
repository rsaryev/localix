import { useMemo, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { useDebouncedQuery } from '@/shared/hooks/useDebouncedQuery'
import type { LspDocumentSymbol } from '@/shared/api/contracts'
import type { EditorHandle } from '@/shared/ui/code-editor/CodeEditor'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

export interface SymbolBreadcrumb {
  /** The chain of symbols whose full span contains the cursor, outermost→innermost. */
  symbolPath: LspDocumentSymbol[]
  /** The full document outline — also feeds the editor's sticky-scroll scope headers. */
  docSymbols: LspDocumentSymbol[]
  /** Called by `CodeEditor.onCursorLineChange`. */
  setCursorLine: (line: number) => void
  /** Ref to wire into `CodeEditor.onEditorReady` so breadcrumb clicks can jump. */
  editorApiRef: React.MutableRefObject<EditorHandle | null>
}

/**
 * Derives the symbol breadcrumb (the function/class enclosing the cursor) for the
 * open editor file. Refreshes symbols after the buffer settles and after each
 * save (`reloadKey`, since edits move ranges), tracks the cursor line, and computes
 * the enclosing-symbol chain.
 */
export function useSymbolBreadcrumb(
  sessionId: string | null | undefined,
  editPath: string,
  reloadKey: string,
  buffer: string,
  /** Quiet time before the symbols are read; a test passes 0. */
  debounceMs = 400,
): SymbolBreadcrumb {
  const workItemVisible = useWorkItemVisible()
  const [docSymbols, setDocSymbols] = useState<LspDocumentSymbol[]>([])
  const [cursorLine, setCursorLine] = useState(0)
  const editorApiRef = useRef<EditorHandle | null>(null)

  // useFileEditor sends didChange after 150ms. Let that sync enter the backend queue first so
  // unsaved edits cannot leave breadcrumb destinations on old lines. reloadKey changes on each
  // successful save → re-derive symbols against the saved file. A hidden tab keeps its outline.
  const hasFile = !!sessionId && !!editPath
  useDebouncedQuery([workItemVisible, sessionId, editPath, reloadKey, buffer], debounceMs, {
    run:
      hasFile && workItemVisible
        ? () => backendClient.lspDocumentSymbols(sessionId, editPath)
        : null,
    onIdle: hasFile ? undefined : () => setDocSymbols([]),
    onResult: setDocSymbols,
    onError: () => setDocSymbols([]),
  })

  const symbolPath = useMemo(() => {
    if (docSymbols.length === 0) return []
    return docSymbols
      .filter((s) => cursorLine >= s.line && cursorLine <= s.endLine)
      .sort((a, b) => a.depth - b.depth)
  }, [docSymbols, cursorLine])

  return { symbolPath, docSymbols, setCursorLine, editorApiRef }
}
