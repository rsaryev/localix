import { useCallback } from 'react'
import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { formatChordText } from '@/shared/lib/keybindings'
import { toast } from '@/shared/lib/notify'
import type { FileTreeGuards } from './useDirectoryLoader'

/* oxlint-disable react-hooks/exhaustive-deps -- refs are stable; the guards object is the tree's single owner */

/**
 * The file tree's Undo: the mod+z shortcut, and the Undo button on each change's Event Center row.
 *
 * Both reach ONE server call that reverses the newest journaled change, so the row's button has to
 * know whether its change is still the newest — otherwise Undo on an older row reverses a later,
 * different change. `undoTokens.ts` is that check; this hook keeps it in step with the server.
 */
export function useTreeUndo({
  sessionId,
  guards,
  ownsSession,
  reloadDir,
}: {
  sessionId: string | null
  guards: FileTreeGuards
  ownsSession: () => boolean
  reloadDir: (path: string) => Promise<boolean>
}) {
  const { undoInFlightRef, undoTokensRef } = guards

  // Reverse the most recent reversible file op (restore-from-trash / move-back / rename-back) and
  // refresh the directories it touched. Overlapping requests join, so one gesture undoes one op.
  const undoLast = useCallback((): Promise<void> => {
    if (!sessionId || !ownsSession()) return Promise.resolve()
    if (undoInFlightRef.current) return undoInFlightRef.current
    const task = (async () => {
      try {
        const res = await backendClient.undoFileOp(sessionId)
        // Keep the row tokens in step with the server's journal. A failed undo is re-journaled
        // server-side, so it changes nothing here.
        if (res.undone) undoTokensRef.current.popped()
        else undoTokensRef.current.cleared()
        if (!ownsSession() || !res.undone) return
        await Promise.all((res.affectedDirs ?? []).map((d) => reloadDir(d)))
      } catch (e) {
        if (ownsSession())
          toast.error('Could not undo the last file change', {
            description: errorMessage(e, '') || undefined,
          })
      }
    })()
    undoInFlightRef.current = task
    const clear = () => {
      if (undoInFlightRef.current === task) undoInFlightRef.current = null
    }
    void task.then(clear, clear)
    return task
  }, [sessionId, ownsSession, reloadDir])

  // A change the server journaled, with or without a row. `message` publishes the row whose Undo
  // reverses THIS change — and refuses once a later one sits above it.
  const toastUndo = useCallback(
    (message?: string) => {
      const token = undoTokensRef.current.record()
      if (!message) return
      const undoThis = () => {
        if (undoTokensRef.current.isLatest(token)) return void undoLast()
        toast.info('This change can no longer be undone from here', {
          description: `A later file change came after it; ${formatChordText('mod+z')} undoes the most recent one`,
        })
      }
      toast.success(message, { action: { label: 'Undo', onClick: undoThis } })
    },
    [undoLast],
  )

  return { undoLast, toastUndo }
}
