import { useStoreChanges } from '@localixai/mini-app-sdk/ui/store-resource'
import { useEffect, useMemo, useState } from 'react'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { DbConnectionInfo } from '../dbClient'
import {
  ensureConnectionsListed,
  refreshConnections,
  revalidateConnections,
  useConnectionsSnapshot,
} from './connectionsStore'

export interface SqlFileConnectionsState {
  /** Only the LIVE (connected) connections — the ones a .sql file can run against. */
  live: DbConnectionInfo[]
  /** The connection this .sql file runs against: the user's explicit pick when it is
   *  still live, else the first live connection, else null. */
  active: DbConnectionInfo | null
  /** Override the active connection (only relevant when more than one is live). */
  setActiveId: (id: string) => void
  /** True until the first list() resolves. */
  loading: boolean
  /** Re-list connections (e.g. after the user connects one in the DB workbench). */
  refresh: () => void
}

/**
 * Connection selection for the .sql-file editor's Run affordance: which LIVE connection this file
 * targets — the sole live one, the user's pick when several are, or none (the caller shows a
 * "connect a database" hint).
 *
 * It reads the shared `connectionsStore` rather than listing on its own: each open .sql tab used
 * to fetch on mount and again on every window focus, so N tabs cost N requests per focus and
 * still missed a connect made in the workbench until the next one. Now a connect anywhere is here
 * at once, and a focus revalidates by JOINING any running read — N tabs, one request.
 */
export function useSqlFileConnections(): SqlFileConnectionsState {
  useStoreChanges({ miniApp: 'database', sessionId: null }, refreshConnections)
  const workItemVisible = useWorkItemVisible()
  const { connections, loading } = useConnectionsSnapshot()
  const [pickedId, setPickedId] = useState<string | null>(null)

  useEffect(() => {
    if (!workItemVisible) return
    ensureConnectionsListed()
    // The backend can gain a live connection this UI never caused (an agent tool); focus is
    // the cheap moment to look again.
    const onFocus = () => revalidateConnections()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [workItemVisible])

  const live = useMemo(() => connections.filter((c) => c.connected), [connections])
  // Derived (no state): the user's pick if still live, else the first live one.
  const active = useMemo(
    () => live.find((c) => c.id === pickedId) ?? live[0] ?? null,
    [live, pickedId],
  )

  return { live, active, setActiveId: setPickedId, loading, refresh: refreshConnections }
}
