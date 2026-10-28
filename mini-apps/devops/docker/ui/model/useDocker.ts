import type { DevOpsIssue } from '../../../ui/DevOpsProblem'
import { dockerIssue } from './dockerIssue'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from '../../backend/contracts'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
import { DockerApiError, dockerApi } from '../dockerApi'
import { stableList } from '../../../ui/model/stableList'
import { useStableCallback } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import {
  cachedDockerComposeAvailable,
  readDockerComposeAvailable,
} from './dockerComposeAvailability'
import {
  dockerEventScope,
  dockerInventoryPollScope,
  dockerPollIntervalMs,
  EMPTY_DOCKER_SNAPSHOT,
  mergeDockerInventory,
  type DockerCollection,
  type DockerSnapshot,
} from './dockerInventory'
import { createDockerRefreshCoordinator, type DockerRefreshScope } from './dockerRefreshCoordinator'
import { createEventRefreshBatcher, useDockerEvents } from './dockerEventsClient'

export {
  DOCKER_RECOVERY_POLL_MS,
  DOCKER_SECONDARY_POLL_MS,
  dockerInventoryPollScope,
  mergeDockerInventory,
} from './dockerInventory'
export type { DockerCollection } from './dockerInventory'

export interface DockerState {
  containers: DockerContainer[]
  images: DockerImage[]
  volumes: DockerVolume[]
  networks: DockerNetwork[]
  loading: boolean
  /** User-visible full refresh; background poll ticks stay visually quiet. */
  refreshing: boolean
  /** Set when the engine is unavailable — the sidebar shows an install/start hint. */
  unavailable: boolean
  /** Whether the `docker compose` CLI is present — gates the project Up action. */
  composeAvailable: boolean
  /** Collection-specific failures keep other successful inventory live and leave
   * the last good rows visible, matching the provider's independent endpoints. */
  resourceErrors: Partial<Record<DockerCollection, DevOpsIssue>>
  error: DevOpsIssue | null
}

/** Last-known daemon snapshot. Docker is host-wide, so reopening the rail can
 * render immediately without a loading flash. */
let snapshotCache: DockerSnapshot | null = null

/**
 * Visibility-aware inventory with coalesced manual refresh and partial recovery, re-read on the
 * daemon's own events while the `docker events` stream is live.
 */
export function useDocker(pollMs = 4000, enabled = true) {
  const [state, setState] = useState<DockerState>(() => ({
    containers: snapshotCache?.containers ?? [],
    images: snapshotCache?.images ?? [],
    volumes: snapshotCache?.volumes ?? [],
    networks: snapshotCache?.networks ?? [],
    loading: snapshotCache === null,
    refreshing: false,
    unavailable: false,
    composeAvailable: cachedDockerComposeAvailable(),
    resourceErrors: {},
    error: null,
  }))
  const lastFullRefreshAt = useRef(0)
  const resourceErrorsRef = useRef(state.resourceErrors)
  const visibleRefreshes = useRef(0)

  const runInventory = useCallback(async (scope: DockerRefreshScope) => {
    if (scope === 'all') {
      try {
        const results = await Promise.allSettled([
          dockerApi.listContainers(),
          dockerApi.listImages(),
          dockerApi.listVolumes(),
          dockerApi.listNetworks(),
        ])
        const merged = mergeDockerInventory(snapshotCache ?? EMPTY_DOCKER_SNAPSHOT, results)
        if (merged.successCount > 0) snapshotCache = merged.snapshot
        resourceErrorsRef.current = merged.resourceErrors
        setState((current) => ({
          ...current,
          ...merged.snapshot,
          loading: false,
          unavailable: merged.unavailable,
          resourceErrors: merged.resourceErrors,
          error: merged.error,
        }))
      } catch (cause) {
        // `allSettled` does not reject; this covers synchronous/runtime failures
        // around request creation without leaving the initial spinner stuck.
        const unavailable = cause instanceof DockerApiError && cause.code === 'engine_unavailable'
        resourceErrorsRef.current = {}
        setState((current) => ({
          ...current,
          loading: false,
          unavailable,
          resourceErrors: {},
          error: dockerIssue(cause),
        }))
      } finally {
        lastFullRefreshAt.current = Date.now()
      }
      return
    }

    try {
      // Same identity-preserving merge as the full refresh: the container cadence is
      // the fast one, so a fresh array here is the most expensive kind of no-op.
      const containers = stableList(
        (snapshotCache ?? EMPTY_DOCKER_SNAPSHOT).containers,
        await dockerApi.listContainers(),
      )
      snapshotCache = { ...(snapshotCache ?? EMPTY_DOCKER_SNAPSHOT), containers }
      const resourceErrors = { ...resourceErrorsRef.current }
      delete resourceErrors.containers
      resourceErrorsRef.current = resourceErrors
      setState((current) => ({
        ...current,
        containers,
        loading: false,
        unavailable: false,
        resourceErrors,
        // A successful daemon read proves this is not a root transport failure.
        error: null,
      }))
    } catch (cause) {
      const unavailable = cause instanceof DockerApiError && cause.code === 'engine_unavailable'
      const resourceErrors = {
        ...resourceErrorsRef.current,
        containers: dockerIssue(cause),
      }
      resourceErrorsRef.current = resourceErrors
      setState((current) => ({
        ...current,
        loading: false,
        unavailable,
        resourceErrors,
        // Keep an isolated collection failure local; an absent engine is the pane's failure, with
        // its Install / Start way out.
        error: unavailable ? dockerIssue(cause) : current.error,
      }))
    }
  }, [])

  const runLatest = useStableCallback(runInventory)
  const coordinator = useMemo(() => createDockerRefreshCoordinator(runLatest), [runLatest])

  const refresh = useCallback(async () => {
    visibleRefreshes.current += 1
    setState((current) => (current.refreshing ? current : { ...current, refreshing: true }))
    try {
      await coordinator.request('all')
    } finally {
      visibleRefreshes.current -= 1
      if (visibleRefreshes.current === 0) {
        setState((current) => (current.refreshing ? { ...current, refreshing: false } : current))
      }
    }
  }, [coordinator])

  // The daemon announces its changes; a burst re-reads once, with the strongest scope it asked for.
  const batcher = useMemo(
    () =>
      createEventRefreshBatcher<DockerRefreshScope>(
        (scope) => void coordinator.request(scope),
        (a, b) => (a === 'all' || b === 'all' ? 'all' : 'containers'),
      ),
    [coordinator],
  )
  useEffect(() => batcher.cancel, [batcher])
  const live = useDockerEvents(enabled, {
    event: (frame) => batcher.push(dockerEventScope(frame.type)),
    resync: () => batcher.push('all'),
  })
  // The stream's state as of the last render, for the poll to read when it fires.
  const liveRef = useRef(live)
  useEffect(() => {
    liveRef.current = live
  }, [live])

  const poll = useCallback(() => {
    const scope = dockerInventoryPollScope(
      lastFullRefreshAt.current,
      Date.now(),
      resourceErrorsRef.current,
      liveRef.current,
    )
    return coordinator.request(scope)
  }, [coordinator])

  useEffect(() => {
    let cancelled = false
    readDockerComposeAvailable()
      .then((available) => {
        if (!cancelled) setState((current) => ({ ...current, composeAvailable: available }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Warm-hidden work items retain their snapshot but make no steady requests. While the events
  // stream is live there is no timer; a cadence change ticks once, which doubles as the
  // re-read for whatever happened while the stream was coming up or going down.
  useVisiblePolling({
    enabled,
    intervalMs: dockerPollIntervalMs(
      live && Object.keys(state.resourceErrors).length === 0,
      pollMs,
    ),
    onTick: poll,
    refreshOnFocus: true,
    immediate: true,
  })

  return { ...state, refresh }
}

/** Shared model consumed by the standalone container view and DevOps Workspace. */
export type DockerWorkbenchModel = ReturnType<typeof useDocker>
