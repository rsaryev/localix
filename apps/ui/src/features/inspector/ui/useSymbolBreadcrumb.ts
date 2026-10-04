import { useEffect, useMemo, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import type { LspDocumentSymbol } from '@/shared/api/contracts'
import type { EditorHandle } from '@/shared/ui/code-editor/CodeEditor'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'

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
): SymbolBreadcrumb {
  const workItemVisible = useWorkItemVisible()
  const [docSymbols, setDocSymbols] = useState<LspDocumentSymbol[]>([])
  const [cursorLine, setCursorLine] = useState(0)
  const editorApiRef = useRef<EditorHandle | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the outline when no file is open in the editor
    if (!sessionId || !editPath) {
      setDocSymbols([])
      return
    }
    if (!workItemVisible) return
    let cancelled = false
    // useFileEditor sends didChange after 150ms. Let that sync enter the backend
    // queue first so unsaved edits cannot leave breadcrumb destinations on old lines.
    const timer = setTimeout(() => {
      void backendClient
        .lspDocumentSymbols(sessionId, editPath)
        .then((syms) => {
          if (!cancelled) setDocSymbols(syms)
        })
        .catch(() => {
          if (!cancelled) setDocSymbols([])
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // reloadKey changes on each successful save → re-derive symbols against the saved file.
  }, [workItemVisible, sessionId, editPath, reloadKey, buffer])

  const symbolPath = useMemo(() => {
    if (docSymbols.length === 0) return []
    return docSymbols
      .filter((s) => cursorLine >= s.line && cursorLine <= s.endLine)
      .sort((a, b) => a.depth - b.depth)
  }, [docSymbols, cursorLine])

  return { symbolPath, docSymbols, setCursorLine, editorApiRef }
}
