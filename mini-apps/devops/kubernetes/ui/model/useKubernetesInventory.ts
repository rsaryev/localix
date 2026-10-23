import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { KubePod } from '../../backend/contracts'
import { kubernetesApi } from '../api/kubernetesApi'
import { degrade, type KubernetesState } from './kubernetesState'
import { collectionErrors, collectionRootState } from './kubernetesCollections'
import { kubernetesScopeIsCurrent, type KubernetesActiveScope } from './kubernetesScope'
import { podsEqual, SLOW_POLL_MS } from './watchPace'

export interface KubernetesRefreshOptions {
  forceSecondary?: boolean
  silent?: boolean
}

interface KubernetesInventoryOptions {
  setState: Dispatch<SetStateAction<KubernetesState>>
  activeRef: MutableRefObject<KubernetesActiveScope>
  generationRef: MutableRefObject<number>
  podsRef: MutableRefObject<KubePod[]>
  busyGenerationRef: MutableRefObject<number | null>
  lastSecondaryFetchAtRef: MutableRefObject<number>
}

/** Two asks for a read folded into one: every collection if either wanted them, quiet if both were. */
export function mergeRefreshOptions(
  queued: KubernetesRefreshOptions | null,
  next: KubernetesRefreshOptions | undefined,
): KubernetesRefreshOptions {
  if (!queued) return { forceSecondary: next?.forceSecondary, silent: next?.silent }
  return {
    forceSecondary: queued.forceSecondary === true || next?.forceSecondary === true,
    silent: queued.silent === true && next?.silent === true,
  }
}

/** Adaptive pod refresh plus slow, independently settled secondary collections. */
export function useKubernetesInventory(options: KubernetesInventoryOptions) {
  const {
    setState,
    activeRef,
    generationRef,
    podsRef,
    busyGenerationRef,
    lastSecondaryFetchAtRef,
  } = options
  const queuedRef = useRef<KubernetesRefreshOptions | null>(null)

  const read = useCallback(
    async (refreshOptions?: KubernetesRefreshOptions) => {
      const { context, namespace } = activeRef.current
      const generation = generationRef.current
      const stamp = { context, namespace, generation }
      if (busyGenerationRef.current === generation) return
      if (!namespace) {
        podsRef.current = []
        setState((state) => ({
          ...state,
          loading: false,
          pods: [],
          deployments: [],
          services: [],
        }))
        return
      }

      busyGenerationRef.current = generation
      if (refreshOptions?.forceSecondary && !refreshOptions.silent) {
        setState((state) => ({ ...state, refreshing: true }))
      }
      const includeSecondary =
        refreshOptions?.forceSecondary === true ||
        Date.now() - lastSecondaryFetchAtRef.current >= SLOW_POLL_MS
      try {
        if (includeSecondary) {
          const results = await Promise.allSettled([
            kubernetesApi.listPods(namespace, context || undefined),
            kubernetesApi.listDeployments(namespace, context || undefined),
            kubernetesApi.listServices(namespace, context || undefined),
            kubernetesApi.listNodes(context || undefined),
            kubernetesApi.listPortForwards(),
          ])
          if (!kubernetesScopeIsCurrent(activeRef.current, generationRef.current, stamp)) return
          const [pods, deployments, services, nodes, forwards] = results
          if (pods.status === 'fulfilled') podsRef.current = pods.value
          lastSecondaryFetchAtRef.current = Date.now()
          setState((state) => ({
            ...state,
            pods:
              pods.status === 'fulfilled'
                ? podsEqual(state.pods, pods.value)
                  ? state.pods
                  : pods.value
                : state.pods,
            deployments: deployments.status === 'fulfilled' ? deployments.value : state.deployments,
            services: services.status === 'fulfilled' ? services.value : state.services,
            nodes: nodes.status === 'fulfilled' ? nodes.value : state.nodes,
            portForwards: forwards.status === 'fulfilled' ? forwards.value : state.portForwards,
            loading: false,
            refreshing: false,
            ...(pods.status === 'rejected'
              ? collectionRootState(pods.reason)
              : { unavailable: false, unreachable: false, error: null }),
            resourceErrors: collectionErrors(results),
            lastUpdatedAt: results.some((result) => result.status === 'fulfilled')
              ? Date.now()
              : state.lastUpdatedAt,
          }))
        } else {
          const pods = await kubernetesApi.listPods(namespace, context || undefined)
          if (!kubernetesScopeIsCurrent(activeRef.current, generationRef.current, stamp)) return
          podsRef.current = pods
          setState((state) => {
            const nextPods = podsEqual(state.pods, pods) ? state.pods : pods
            const settled =
              nextPods === state.pods &&
              !state.loading &&
              !state.refreshing &&
              !state.unavailable &&
              !state.unreachable &&
              state.error === null
            return settled
              ? state
              : {
                  ...state,
                  pods: nextPods,
                  loading: false,
                  refreshing: false,
                  unavailable: false,
                  unreachable: false,
                  error: null,
                  resourceErrors: { ...state.resourceErrors, pods: undefined },
                  lastUpdatedAt: Date.now(),
                }
          })
        }
      } catch (cause) {
        if (!kubernetesScopeIsCurrent(activeRef.current, generationRef.current, stamp)) return
        setState((state) => ({ ...state, loading: false, refreshing: false, ...degrade(cause) }))
      } finally {
        if (busyGenerationRef.current === generation) busyGenerationRef.current = null
      }
    },
    [activeRef, busyGenerationRef, generationRef, lastSecondaryFetchAtRef, podsRef, setState],
  )

  // An ask that lands while a read is in flight is not dropped: a change frame heard then may
  // postdate what that read saw, and with the watches live no timer would read it later.
  return useCallback(
    async (refreshOptions?: KubernetesRefreshOptions) => {
      if (busyGenerationRef.current === generationRef.current) {
        queuedRef.current = mergeRefreshOptions(queuedRef.current, refreshOptions)
        return
      }
      await read(refreshOptions)
      while (queuedRef.current && busyGenerationRef.current !== generationRef.current) {
        const next = queuedRef.current
        queuedRef.current = null
        await read(next)
      }
    },
    [busyGenerationRef, generationRef, read],
  )
}
