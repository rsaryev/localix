import { useCallback, useState } from 'react'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import type { DbConnectionInfo } from '../../dbClient'
import { closeDbConnectionWorkItems } from '../../model/openConsole'
import { schemaStore } from '../../model/schemaStore'
import { clearConnectionConsoleDrafts } from '../../model/useConsoleDraftCleanup'
import type { DbConnectionsState } from '../../model/useDbConnections'

/**
 * Removing a saved connection, as a two-step: the sidebar X / ReconnectCard Remove only OPENS the
 * confirm dialog — the X sits one slip away from Rename/Edit, and a saved connection (config +
 * credentials) is not something to lose to a stray click.
 *
 * `onRequest` runs when a removal is staged, so the caller can cancel work that would otherwise
 * land on a connection about to vanish (a pending "Edit connection…" config fetch).
 */
export function useRemoveConnection(
  connections: DbConnectionInfo[],
  remove: DbConnectionsState['remove'],
  onRequest: () => void,
) {
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  // A delete the server refused, named — remove() failing used to be silent, so the click
  // looked ignored while the row (correctly) stayed put.
  const [removeError, setRemoveError] = useState<Problem | null>(null)
  const confirmRemoveName = connections.find((c) => c.id === confirmRemove)?.name ?? null

  const removeConnection = useCallback(
    (id: string) => {
      onRequest()
      setRemoveError(null)
      setConfirmRemove(id)
    },
    [onRequest],
  )

  const onConfirmRemove = useCallback(() => {
    if (!confirmRemove) return
    const id = confirmRemove
    setConfirmRemove(null)
    // Close the console only once the delete is CONFIRMED. Closing it unconditionally meant a
    // failed delete tore down the user's console tab for a connection that is still there.
    void remove(id).then((failure) => {
      if (failure) {
        setRemoveError(failure)
        return
      }
      schemaStore.invalidate(id)
      try {
        clearConnectionConsoleDrafts(id, localStorage)
      } catch {
        /* storage unavailable — the confirmed server removal still succeeded */
      }
      closeDbConnectionWorkItems(id)
    })
  }, [confirmRemove, remove])

  return {
    removeConnection,
    confirmRemove,
    confirmRemoveName,
    setConfirmRemove,
    onConfirmRemove,
    removeError,
  }
}
