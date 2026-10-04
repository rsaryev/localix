import { useCallback, useEffect, useState } from 'react'
import type { PortForward } from '../../backend/contracts'
import { useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'
import { kubernetesApi } from '../api/kubernetesApi'

/**
 * Whether the tab's forward list needs its five-second re-read.
 *
 * A forward for this tab's owner is started only by this tab (its dialog hands it to `add`) and
 * stopped through `stop`, so the one change the tab cannot see is a forward DYING on the server —
 * a tunnel the cluster closed. With no forward there is nothing to die: polling an empty list every
 * five seconds for as long as a pod tab was open re-read a list nothing could change. The pod watch
 * does not carry forwards (they are this process's sockets, not cluster objects), so while there is
 * one, the poll stays.
 */
export function portForwardPollNeeded(active: boolean, forwardCount: number): boolean {
  return active && forwardCount > 0
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

  // One read when the tab shows (a reopened tab finds the forwards it started before), then the
  // poll only while a forward exists to die.
  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])
  useVisiblePolling({
    enabled: portForwardPollNeeded(active, forwards.length),
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
