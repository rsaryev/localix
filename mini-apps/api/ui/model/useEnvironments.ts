/**
 * The environment list + the active one, for the picker.
 *
 * Hears its changes the way the request list does, and for the same reason: the AGENT switches
 * environments during a chat turn (`api_client`, target environment → `use`), with no focus
 * event, and environment files can be rewritten on disk. A picker showing a stale "staging" while
 * requests go to prod is worse than no picker. The tool's change arrives on `API_ENVIRONMENTS`, a
 * file rewritten in `.localix/api/environments/` through the workspace watcher
 * (`useFileResourceSync`); the poll is used only while that watcher is unavailable.
 */

import { useCallback, useRef, useState } from 'react'
import { useFileResourceSync } from '@localixai/mini-app-sdk/ui/file-resource-sync'
import type { EnvironmentCreate, EnvironmentEdit, EnvironmentInfo } from '../../backend/contracts'
import { restApi } from '../restApi'
import { useResourceTopic } from '@localixai/mini-app-sdk/ui/shared-resource'
import { API_ENVIRONMENTS } from './topics'
import { toast } from '@localixai/mini-app-sdk/ui'

const POLL_MS = 15_000

export function useEnvironments(sessionId: string) {
  const [environments, setEnvironments] = useState<EnvironmentInfo[]>([])
  const [loading, setLoading] = useState(true)

  const switching = useRef(0)
  const { refresh, supersede } = useFileResourceSync({
    sessionId,
    prefix: '.localix/api',
    fallbackMs: POLL_MS,
    read: (signal) => restApi.environments(sessionId, signal),
    apply: (value) => {
      if (switching.current) return
      setEnvironments(value)
      setLoading(false)
    },
    onError: () => setLoading(false),
  })

  // One signal for both directions: the agent's `collection_changed` is folded into the same
  // topic `restApi` invalidates after every write, so this picker and the titlebar item always
  // move together whichever of them caused the change.
  useResourceTopic(API_ENVIRONMENTS, () => void refresh())

  const use = useCallback(
    async (name: string) => {
      // Optimistic: the flag moves in the UI immediately, then the server confirms. A picker that
      // waits a round-trip to show the choice feels broken; a refresh follows either way, so a
      // failed switch corrects itself rather than lying. An empty name is the "no environment"
      // choice — every flag clears; literal URLs still work while unresolved templates fail loud.
      switching.current++
      supersede()
      setEnvironments((all) => all.map((e) => ({ ...e, active: e.name === name })))
      try {
        await restApi.useEnvironment(sessionId, name)
      } catch (err) {
        // Worded as the titlebar item words it, so the same failure reads the same from both.
        toast.error(
          name === '' ? 'Could not clear the environment' : `Could not switch to “${name}”`,
          {
            description: err instanceof Error ? err.message : undefined,
          },
        )
      } finally {
        switching.current--
        await refresh()
      }
    },
    [sessionId, refresh, supersede],
  )

  // The management verbs the editor drives. Each rethrows the typed RestApiError so the editor can
  // surface a `name_taken` / `bad_request` inline; `refresh` runs regardless so the list reflects
  // whatever the server now holds — a partial write is still worth showing.
  const create = useCallback(
    async (input: EnvironmentCreate): Promise<EnvironmentInfo> => {
      try {
        return await restApi.createEnvironment(sessionId, input)
      } finally {
        await refresh()
      }
    },
    [sessionId, refresh],
  )

  const update = useCallback(
    async (name: string, edit: EnvironmentEdit): Promise<EnvironmentInfo> => {
      try {
        return await restApi.updateEnvironment(sessionId, name, edit)
      } finally {
        await refresh()
      }
    },
    [sessionId, refresh],
  )

  const remove = useCallback(
    async (name: string): Promise<void> => {
      try {
        await restApi.removeEnvironment(sessionId, name)
      } finally {
        await refresh()
      }
    },
    [sessionId, refresh],
  )

  const rename = useCallback(
    async (name: string, to: string): Promise<EnvironmentInfo> => {
      try {
        return await restApi.renameEnvironment(sessionId, name, to)
      } finally {
        await refresh()
      }
    },
    [sessionId, refresh],
  )

  const duplicate = useCallback(
    async (name: string): Promise<EnvironmentInfo> => {
      try {
        return await restApi.duplicateEnvironment(sessionId, name)
      } finally {
        await refresh()
      }
    },
    [sessionId, refresh],
  )

  const active = environments.find((e) => e.active) ?? null
  return { environments, active, loading, refresh, use, create, update, remove, rename, duplicate }
}
