import { useCallback, useState } from 'react'
import { openFileInGrid } from '@/shared/lib/recentFiles'
import { usePeekDefinition, type PeekTarget } from './usePeekDefinition'

/** Go-to-definition / cross-reference navigation plus the inline Peek Definition panel. */
export function useFileTabNavigation(sessionId: string) {
  // Editor go-to-definition / cross-reference navigation (distinct from comments).
  const onLocationNavigate = useCallback(
    (loc: { file: string; line: number; column?: number }) => {
      if (!sessionId) return
      openFileInGrid({
        sessionId,
        path: loc.file,
        line: loc.line + 1,
        ...(loc.column !== undefined ? { column: loc.column } : {}),
      })
    },
    [sessionId],
  )

  // Peek Definition (Alt+F12): preview the definition inline in a docked panel
  // without navigating away; "Open" then jumps there for real. This tab remounts
  // per file (keyed by path in the grid), so the peek never outlives its file.
  // The read lives here rather than in the panel: the panel unmounts when the peek
  // closes, and a problem owner that unmounts can never settle its row.
  const [peekTarget, setPeekTarget] = useState<PeekTarget | null>(null)
  const peekView = usePeekDefinition(sessionId, peekTarget)
  const onPeekDefinition = useCallback((loc: PeekTarget) => setPeekTarget(loc), [])
  const openPeekTarget = useCallback(
    (loc: PeekTarget) => {
      onLocationNavigate({ file: loc.file, line: loc.line, column: loc.character })
      setPeekTarget(null)
    },
    [onLocationNavigate],
  )
  const closePeek = useCallback(() => setPeekTarget(null), [])

  return { onLocationNavigate, peekTarget, peekView, onPeekDefinition, openPeekTarget, closePeek }
}
