import { useCallback, useEffect, useState } from 'react'
import type { PortForward } from '../../backend/contracts'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
import { kubernetesApi } from '../api/kubernetesApi'
import { usePortForwardsFeed } from './portForwardsFeed'

/**
 * Whether the tab's forward list needs its five-second re-read.
 *
 * The registry announces every start, stop and death of a forward on the realtime stream, and the
 * tab re-reads on that frame, so while the stream is live nothing is polled. Only while it is down
 * does the poll stand in, and only with a forward to die — a tunnel the cluster closed is the one
 * change the tab cannot see itself, and an empty list has nothing that could change on its own.
 */
export function portForwardPollNeeded(
  active: boolean,
  forwardCount: number,
  streamLive: boolean,
): boolean {
  return active && forwardCount > 0 && !streamLive
}

/** Owner-scoped port-forward inventory and stop lifecycle for one pod editor tab. */
export function usePodPortForwards(active: boolean, owner: string) {
  const [forwards, setForwards] = useState<PortForward[]>([])
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set())

  const refresh = useCallback(async () => {
    try {
      const all = await kubernetesApi.listPortForwards()
      setForwards(all.filter((forward) => forward.owner === owner))
    } catch {
      // Secondary inventory keeps its last good snapshot while the pod's primary views recover.
    }
  }, [owner])

  // One read when the tab shows (a reopened tab finds the forwards it started before), then a
  // re-read per announced change; the poll only while the stream is down and a forward could die.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    // Started from a microtask: the read's results are set from its own callback, not while this
    // effect runs.
    queueMicrotask(() => {
      if (!cancelled) void refresh()
    })
    return () => {
      cancelled = true
    }
  }, [active, refresh])
  const streamLive = usePortForwardsFeed(active, () => void refresh())
  useVisiblePolling({
    enabled: portForwardPollNeeded(active, forwards.length, streamLive),
    intervalMs: 5000,
    onTick: refresh,
    resetKey: owner,
  })

  const add = useCallback((forward: PortForward) => {
    setForwards((current) => [
      ...current.filter((candidate) => candidate.id !== forward.id),
      forward,
    ])
  }, [])

  const stop = useCallback(async (id: string) => {
    setStopping((current) => new Set(current).add(id))
    try {
      await kubernetesApi.stopPortForward(id)
      setForwards((current) => current.filter((forward) => forward.id !== id))
    } finally {
      setStopping((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }, [])

  return { forwards, stopping, add, stop }
}
