import { useCallback, useEffect, useRef, useState } from 'react'
import type { KubePod } from '../../backend/contracts'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
import { kubernetesApi } from '../api/kubernetesApi'
import { KubeApiError } from '../api/transport'
import { subscribePodWatch } from './podWatchClient'
import { applyPodWatch } from './watchPace'
import { PodSeedCoordinator } from './podSeedCoordinator'

export function podSnapshotMatches(
  pod: KubePod | undefined,
  podName: string,
  namespace: string,
): pod is KubePod {
  return pod?.name === podName && pod.namespace === namespace
}

interface PodTabSeedOptions {
  active: boolean
  podName: string
  namespace: string
  context?: string
  initialPod?: KubePod
}

/** Seed one pod, keep it current through the shared watch, and retry only failed seed reads. */
export function usePodTabSeed(options: PodTabSeedOptions) {
  const { active, podName, namespace, context, initialPod } = options
  const targetKey = `${context ?? ''}\u0000${namespace}\u0000${podName}`
  const seededPod = podSnapshotMatches(initialPod, podName, namespace) ? initialPod : null
  const [pod, setPod] = useState<KubePod | null>(seededPod)
  const podRef = useRef<KubePod | null>(seededPod)
  const [loading, setLoading] = useState(!seededPod)
  const [error, setError] = useState<string | null>(null)
  const [seedFailed, setSeedFailed] = useState(false)
  const seedSeq = useRef(0)
  const seedCoordinator = useRef(new PodSeedCoordinator())
  const seededTarget = useRef(seededPod ? targetKey : '')

  const setPodState = useCallback((match: KubePod | null) => {
    podRef.current = match
    setPod(match)
  }, [])

  const seedPod = useCallback((): Promise<void> => {
    const generation = seedSeq.current
    const key = `${context ?? ''}\u0000${namespace}\u0000${podName}`
    return seedCoordinator.current.run(generation, key, async () => {
      try {
        const match =
          (await kubernetesApi.listPods(namespace, context || undefined)).find(
            (candidate) => candidate.name === podName,
          ) ?? null
        if (generation !== seedSeq.current) return
        setPodState(match)
        setError(match ? null : 'Pod no longer exists.')
        setSeedFailed(false)
      } catch (cause) {
        if (generation !== seedSeq.current) return
        setError(cause instanceof KubeApiError ? cause.message : 'Could not reach the cluster.')
        setSeedFailed(true)
      } finally {
        if (generation === seedSeq.current) setLoading(false)
      }
    })
  }, [context, namespace, podName, setPodState])

  useEffect(() => {
    if (!active) return
    let disposed = false
    seedSeq.current += 1
    if (seededTarget.current !== targetKey) {
      setPodState(null)
      setError(null)
      setSeedFailed(false)
      setLoading(true)
      void seedPod()
    }
    const unsubscribe = subscribePodWatch(context, namespace, {
      onPod: (action, incoming) => {
        if (disposed) return
        const match =
          applyPodWatch(podRef.current ? [podRef.current] : [], action, incoming).find(
            (candidate) => candidate.name === podName,
          ) ?? null
        if (match) {
          setPodState(match)
          setError(null)
        } else if (action === 'DELETED' && incoming.name === podName) {
          setPodState(null)
          setError('Pod no longer exists.')
        }
      },
      onReconnect: () => {
        if (!disposed) void seedPod()
      },
    })
    return () => {
      disposed = true
      seedSeq.current += 1
      unsubscribe()
    }
  }, [active, context, namespace, podName, seedPod, setPodState, targetKey])

  useVisiblePolling({
    enabled: active && seedFailed,
    intervalMs: 5000,
    onTick: seedPod,
    resetKey: `${podName}/${namespace}/${context ?? ''}`,
  })

  const markAbsent = useCallback(
    (message: string) => {
      setPodState(null)
      setError(message)
    },
    [setPodState],
  )

  return { pod, loading, error, seedPod, markAbsent }
}
