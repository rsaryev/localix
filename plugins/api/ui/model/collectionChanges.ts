import { workspacePathsTouch } from '@localixai/plugin-sdk/ui/file-resource-sync'
import { useCallback } from 'react'
import type { PluginWorkspaceChange } from '@localixai/plugin-sdk/ui/runtime'
import { usePluginWorkspaceChanges } from '@localixai/plugin-sdk/ui/runtime-hooks'

/**
 * The collection's folder inside the chat's workspace, as path segments — the backend's
 * `COLLECTION_DIR` (`backend/collection/paths.ts`, which `collectionChanges.test.ts` pins this
 * against). Restated here because that module imports `node:path`, which the browser bundle
 * cannot take.
 */
export const COLLECTION_SEGMENTS = ['.localix', 'api'] as const

/**
 * Whether a workspace change can have moved the collection: a path at or under its folder, or a
 * coarse change (`paths: null` — a watcher restart or a burst too large to list), which may have.
 */
export function touchesCollection(change: Pick<PluginWorkspaceChange, 'paths'>): boolean {
  return workspacePathsTouch(change.paths, COLLECTION_SEGMENTS.join('/'))
}

/**
 * Re-read when the chat's collection changes ON DISK, and say whether that signal is live.
 *
 * The lists polled every 15 s for the one change no call announces. The `api_client` tool says
 * what it saved (`collectionEvents.ts`), but a collection is plain JSON in the workspace: the
 * agent's file tools, a `git checkout` or another editor rewrite it with nothing announced, and
 * the sidebar kept the old requests for up to a poll. The host's workspace watcher hears those
 * writes; healthy lists need no poll; unsupported or failed watchers retain a fallback.
 */
export function useCollectionChanges(sessionId: string, refresh: () => void): boolean | null {
  const onChange = useCallback(
    (change: PluginWorkspaceChange) => {
      if (touchesCollection(change)) refresh()
    },
    [refresh],
  )
  return usePluginWorkspaceChanges(sessionId, onChange)
}
