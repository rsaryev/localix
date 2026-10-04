/**
 * The saved-requests list for the rail sidebar.
 *
 * The list changes underneath us: the AGENT saves and imports requests during a chat turn, in this
 * same window, with no focus change to notice. It hears those changes rather than polling for
 * them — the `api_client` tool's `collection_changed` command, and the workspace watcher for a
 * collection file rewritten on disk (`collectionChanges.ts`) — and re-reads at once.
 *
 * The poll is the backstop for a missed event: slow while the watcher is live, at the old 15 s
 * while it is not (a remote chat, a failed watcher), plus `refreshOnFocus` for coming back to the
 * window; the visibility gate means a hidden tab costs nothing either way.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'
import type { RequestInfo } from '../../backend/contracts'
import { restApi } from '../restApi'
import { subscribeApiWorkspaceCommands } from './collectionEvents'
import { COLLECTION_BACKSTOP_MS, useCollectionChanges } from './collectionChanges'

/** While the workspace watcher is not live — see the header. */
const POLL_MS = 15_000

export interface RequestsState {
  requests: RequestInfo[]
  folders: string[]
  loading: boolean
  error: string | null
}

export function useRequests(sessionId: string) {
  const [state, setState] = useState<RequestsState>({
    requests: [],
    folders: [],
    loading: true,
    error: null,
  })
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    // Drop an overlapping tick rather than race two loads into setState.
    if (busy.current) return
    busy.current = true
    try {
      const [requests, folders] = await Promise.all([
        restApi.list(sessionId),
        restApi.folders(sessionId),
      ])
      setState({ requests, folders, loading: false, error: null })
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Could not load the saved requests.',
      }))
    } finally {
      busy.current = false
    }
  }, [sessionId])

  const watched = useCollectionChanges(sessionId, () => void refresh())
  useVisiblePolling({
    intervalMs: watched ? COLLECTION_BACKSTOP_MS : POLL_MS,
    onTick: refresh,
    refreshOnFocus: true,
    immediate: true,
  })

  useEffect(
    () =>
      subscribeApiWorkspaceCommands((command) => {
        if (command.type === 'collection_changed' && command.target === 'request') void refresh()
      }),
    [refresh],
  )

  return { ...state, refresh }
}
