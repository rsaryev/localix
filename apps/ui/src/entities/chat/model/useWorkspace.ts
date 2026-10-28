import { useCallback, useState } from 'react'
import useSWR, { useSWRConfig, type SWRConfiguration } from 'swr'
import { useChatStore } from './store'
import { backendClient } from '@/shared/api/client'
import { resourceSync } from '@/shared/api/resourceSync'
import {
  scheduleStartupRetry,
  shouldSurfaceStartupFailure,
  startupRetryDelay,
  type StartupRetrySchedule,
} from '@/shared/lib/startupRetry'
import { runtimeReadyBarrier } from '@/shared/lib/runtimeReady'
import { applyServerSession } from './sessionSync'

const STARTUP_REQUEST_TIMEOUT_MS = 5_000

async function withStartupDeadline<T>(load: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // Cross the shell's readiness barrier BEFORE arming the deadline: a cold
  // sidecar boot is not a slow request, and timing it as one turned an ordinary
  // 3.8s start into an aborted read plus an error state.
  const barrier = runtimeReadyBarrier()
  if (barrier) await barrier
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('Local service request timed out')),
    STARTUP_REQUEST_TIMEOUT_MS,
  )
  try {
    return await load(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

function startupSWRConfig(schedule: StartupRetrySchedule) {
  return {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    // SWR's global retry starts around 5–10 seconds. That is sensible for remote
    // APIs but leaves a local desktop sidecar stale after it comes online. Probe
    // densely during the expected startup window, then cap at a quiet 10s cadence.
    onErrorRetry: (_error, _key, _config, revalidate, { retryCount }) => {
      const delay = startupRetryDelay(Math.max(0, retryCount - 1))
      schedule(() => void revalidate({ retryCount, dedupe: true }), delay)
    },
  } satisfies SWRConfiguration
}

/**
 * Imperative whole-workspace refresh without subscribing the caller to four SWR
 * resources. ChatSurface uses this for rollback/edit recovery; keeping the data
 * hooks in ChatPage avoids every warm-hidden chat re-rendering on unrelated
 * workspace, project, connection, or active-detail cache changes.
 */
export function useWorkspaceReloader(): () => Promise<void> {
  const { mutate } = useSWRConfig()
  return useCallback(async () => {
    const activeSessionId = useChatStore.getState().activeSessionId
    await Promise.all([
      mutate('workspace'),
      // Connections and projects have one writer each, the realtime resource adapters.
      resourceSync.refresh(['providers', 'projects']),
      ...(activeSessionId ? [mutate(['workspace:session', activeSessionId])] : []),
    ])
  }, [mutate])
}

/** `schedule` is the retry timer; a test passes its own to step the backoff without waiting. */
export function useWorkspace({
  schedule = scheduleStartupRetry,
}: { schedule?: StartupRetrySchedule } = {}) {
  const swrConfig = startupSWRConfig(schedule)
  const reload = useWorkspaceReloader()
  const loadWorkspace = useChatStore((state) => state.loadWorkspace)
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const hasHydrated = useChatStore((state) => state._hasHydrated)
  // Consecutive failures of the PRIMARY workspace read. SWR exposes `error` from
  // the first rejection, which on desktop meant a red "could not be loaded" strip
  // for a sidecar that was merely still booting — visible for a moment, then gone.
  // Counting them lets the surface use the same patience threshold every other
  // startup loop already applies.
  const [failures, setFailures] = useState(0)

  const workspace = useSWR(
    'workspace',
    () => withStartupDeadline((signal) => loadWorkspace(signal)),
    {
      ...swrConfig,
      onError: () => setFailures((count) => count + 1),
      // Reset so a much later blip starts its own patience window instead of
      // inheriting a count spent during startup.
      onSuccess: () => setFailures((count) => (count === 0 ? count : 0)),
    },
  )
  useSWR(
    hasHydrated && activeSessionId ? ['workspace:session', activeSessionId] : null,
    ([, sessionId]) =>
      withStartupDeadline(async (signal) => {
        const session = await backendClient.getSession(sessionId, signal)
        applyServerSession(session)
      }),
    {
      ...swrConfig,
      // URL→store selection is the sole automatic detail owner. Revalidating
      // this SWR key on mount/key-change issued a second concurrent getSession
      // for every route switch. Explicit rollback/edit recovery still calls
      // `reload()` below, which revalidates this key on demand.
      revalidateOnMount: false,
    },
  )

  return {
    ...workspace,
    // A failure is reportable only once the dense retry window is spent. Before
    // that it is indistinguishable from "the local service is still starting",
    // and reporting it as an error is simply wrong.
    error: shouldSurfaceStartupFailure(failures - 1) ? workspace.error : undefined,
    mutate: reload,
  }
}
