import { useEffect, useState } from 'react'
import { runAsBackgroundWork } from '@localixai/mini-app-sdk/ui/visibility'
import type { NodeUsage, PodUsage } from '../../backend/contracts'
import { kubernetesApi } from '../api/kubernetesApi'
import { indexNodeUsage, indexPodUsage, usagePollDelay } from './usage'

/**
 * Poll live usage for the visible resource view.
 *
 * A SEPARATE loop from `usePodPollLoop`, not another field on it, for the same reason
 * the endpoint is separate: `metrics.k8s.io` is an optional aggregated API server that
 * can be absent or slow, and a usage request that hangs must never delay the pod list
 * it decorates. Failures are swallowed — usage is decoration, and the pod list already
 * owns the cluster's error state.
 *
 * Only the view being looked at is asked for: nodes usage costs a cluster-wide request,
 * so it is not fetched while the user is reading a namespace's pods.
 *
 * Honors the same visibility contract as the pod poll: a hidden tab makes no steady
 * round-trips, and returning refreshes at once.
 */
export function useUsageMetrics({
  enabled,
  context,
  namespace,
  wantPods,
  wantNodes,
}: {
  enabled: boolean
  context: string
  namespace: string
  wantPods: boolean
  wantNodes: boolean
}): { podUsage: Map<string, PodUsage>; nodeUsage: Map<string, NodeUsage> } {
  const [podUsage, setPodUsage] = useState<Map<string, PodUsage>>(() => new Map())
  const [nodeUsage, setNodeUsage] = useState<Map<string, NodeUsage>>(() => new Map())

  const idle = !enabled || (!wantPods && !wantNodes)
  // Drop stale numbers instead of leaving the last cluster's usage on screen. Decided while
  // rendering, as soon as polling stops, so a later start never shows the old numbers first.
  if (idle && (podUsage.size > 0 || nodeUsage.size > 0)) {
    setPodUsage(new Map())
    setNodeUsage(new Map())
  }

  useEffect(() => {
    if (idle) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      const [pods, nodes] = await Promise.all([
        wantPods && namespace
          ? kubernetesApi.podMetrics(namespace, context || undefined).catch(() => null)
          : Promise.resolve(null),
        wantNodes
          ? kubernetesApi.nodeMetrics(context || undefined).catch(() => null)
          : Promise.resolve(null),
      ])
      if (stopped) return
      if (wantPods) setPodUsage(indexPodUsage(pods))
      if (wantNodes) setNodeUsage(indexNodeUsage(nodes))
      if (document.visibilityState !== 'visible') return
      // `null` from EVERY requested endpoint means this cluster has no metrics API, so
      // back off hard instead of asking a 404 for it every ten seconds all day.
      const available = (wantPods && pods !== null) || (wantNodes && nodes !== null)
      timer = setTimeout(() => {
        timer = undefined
        void runAsBackgroundWork(tick)
      }, usagePollDelay(available))
    }

    void tick()
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
        return
      }
      if (!stopped && !timer) void tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [idle, context, namespace, wantPods, wantNodes])

  return { podUsage, nodeUsage }
}
