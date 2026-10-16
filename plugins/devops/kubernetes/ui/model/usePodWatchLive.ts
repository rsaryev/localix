import { useEffect } from 'react'
import type { KubePod } from '../../backend/contracts'
import type { KubernetesState } from './kubernetesState'
import { subscribePodWatch } from './podWatchClient'
import { applyPodWatch } from './watchPace'

/**
 * Live watch: subscribe to the shared API informer for the active (context,
 * namespace) over the realtime WS. Pod add/modify/delete frames reconcile the list
 * instantly by name; a status frame flips the live/polling indicator. The initial
 * list is still seeded by the REST refresh (the watch carries deltas) — so a
 * watch that never comes up simply leaves the poll fallback in charge.
 *
 * Extracted from `useKubernetes` unchanged; the refs + `setState` are stable, so
 * listing them in the deps adds no re-runs.
 */
export function usePodWatchLive({
  enabled,
  context,
  namespace,
  activeRef,
  refresh,
  podsRef,
  watchLiveRef,
  setState,
}: {
  enabled: boolean
  /** The state-tracked active context (the effect's re-subscribe key). */
  context: string
  namespace: string
  /** The imperative `{ context, namespace }` ref the subscribe call reads. */
  activeRef: React.MutableRefObject<{ context: string; namespace: string }>
  refresh: () => Promise<void>
  podsRef: React.MutableRefObject<KubePod[]>
  watchLiveRef: React.MutableRefObject<boolean>
  setState: React.Dispatch<React.SetStateAction<KubernetesState>>
}): void {
  useEffect(() => {
    if (!enabled || !context || !namespace) return

    const stillCurrent = () =>
      activeRef.current.context === context && activeRef.current.namespace === namespace

    const setWatchLive = (live: boolean) => {
      if (!stillCurrent()) return
      if (watchLiveRef.current === live) return
      watchLiveRef.current = live
      setState((s) => ({ ...s, watchLive: live }))
    }

    const unsubscribe = subscribePodWatch(context, namespace, {
      onPod: (action, pod) => {
        if (!stillCurrent()) return
        podsRef.current = applyPodWatch(podsRef.current, action, pod)
        const nextPods = podsRef.current
        setState((s) => ({ ...s, pods: nextPods }))
      },
      onStatus: (status) => setWatchLive(status === 'live'),
      // Resync from REST after a reconnect re-subscribe so no delta is lost.
      onReconnect: () => {
        if (stillCurrent()) void refresh()
      },
    })

    return () => {
      unsubscribe()
      setWatchLive(false)
    }
  }, [enabled, context, namespace, refresh, activeRef, podsRef, watchLiveRef, setState])
}
