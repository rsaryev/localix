import { useCallback, useEffect, useRef, useState } from 'react'
import { resourceMessageBindingDraft, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { ALL_NAMESPACES, type KubeNode, type KubePod } from '../../backend/contracts'
import { kubernetesApi } from '../api/kubernetesApi'
import { KubeApiError } from '../api/transport'
import { buildK8sNodeUri, buildK8sNodeViewUri } from './resourceLink'
import { podsOnNode } from './sortResources'
import { nodeReservation, nodeUsageDisplay } from './usage'
import { useUsageMetrics } from './useUsageMetrics'

export type KubernetesNodeView = 'overview' | 'pods' | 'manifest'

export function nodeSnapshotMatches(node: KubeNode | undefined, name: string): node is KubeNode {
  return node?.name === name
}

export function useKubernetesNodeTab({
  active,
  name,
  context,
  initialNode,
  publishMessageContext,
}: {
  active: boolean
  name: string
  context?: string
  initialNode?: KubeNode
  publishMessageContext?: PublishMessageContext
}) {
  const seededNode = nodeSnapshotMatches(initialNode, name) ? initialNode : null
  const targetKey = `${context ?? ''}/${name}`
  const [node, setNode] = useState<KubeNode | null>(seededNode)
  const [view, setView] = useState<KubernetesNodeView>('overview')
  const [loading, setLoading] = useState(!seededNode)
  const [error, setError] = useState<string | null>(null)
  const [pods, setPods] = useState<KubePod[]>([])
  const [podsLoading, setPodsLoading] = useState(false)
  const [podsError, setPodsError] = useState<string | null>(null)
  const [podsFetched, setPodsFetched] = useState(false)
  const [podFilter, setPodFilter] = useState('')
  const nodeSeq = useRef(0)
  const podsSeq = useRef(0)
  const seededTarget = useRef(seededNode ? targetKey : '')
  const uri = buildK8sNodeUri({ context, name })
  const { nodeUsage } = useUsageMetrics({
    enabled: active && !!node,
    context: context ?? '',
    namespace: '',
    wantPods: false,
    wantNodes: true,
  })
  const usage = node ? nodeUsageDisplay(node, nodeUsage.get(node.name)) : null
  const reservation = node && podsFetched ? nodeReservation(podsOnNode(pods, name, ''), node) : null

  useEffect(() => {
    if (!publishMessageContext || !name) return
    const contextUri =
      view === 'manifest' ? buildK8sNodeViewUri({ context, name, view: 'manifest' }) : uri
    publishMessageContext({
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: contextUri,
          label: `${name} ${view}`,
        }),
      ],
    })
  }, [context, name, publishMessageContext, uri, view])

  const refresh = useCallback(async () => {
    const seq = ++nodeSeq.current
    setLoading(true)
    try {
      const match =
        (await kubernetesApi.listNodes(context || undefined)).find(
          (candidate) => candidate.name === name,
        ) ?? null
      if (seq !== nodeSeq.current) return
      setNode(match)
      setError(match ? null : 'Node no longer exists.')
    } catch (cause) {
      if (seq !== nodeSeq.current) return
      setError(cause instanceof KubeApiError ? cause.message : 'Could not reach the cluster.')
    } finally {
      if (seq === nodeSeq.current) setLoading(false)
    }
  }, [context, name])

  useEffect(() => {
    if (!active || seededTarget.current === targetKey) return
    seededTarget.current = targetKey
    void refresh()
  }, [active, refresh, targetKey])

  useEffect(
    () => () => {
      nodeSeq.current += 1
    },
    [],
  )

  const refreshPods = useCallback(async () => {
    const seq = ++podsSeq.current
    setPodsLoading(true)
    setPodsError(null)
    try {
      const rows = await kubernetesApi.listPods(ALL_NAMESPACES, context || undefined)
      if (seq !== podsSeq.current) return
      setPods(rows.filter((pod) => pod.node === name))
      setPodsFetched(true)
    } catch (cause) {
      if (seq !== podsSeq.current) return
      setPodsError(
        cause instanceof KubeApiError ? cause.message : 'Could not load the pods on this node.',
      )
    } finally {
      if (seq === podsSeq.current) setPodsLoading(false)
    }
  }, [context, name])

  useEffect(() => {
    let cancelled = false
    // Started from a microtask: the read's loading and results are set from its own callbacks, not
    // while this effect runs.
    if (active && (view === 'pods' || view === 'overview')) {
      queueMicrotask(() => {
        if (!cancelled) void refreshPods()
      })
    }
    return () => {
      cancelled = true
      podsSeq.current += 1
    }
  }, [active, refreshPods, view])

  return {
    uri,
    node,
    view,
    setView,
    loading,
    error,
    pods,
    podsLoading,
    podsError,
    podFilter,
    setPodFilter,
    visiblePods: podsOnNode(pods, name, podFilter),
    usage,
    reservation,
    refresh,
    refreshPods,
  }
}

export type KubernetesNodeTabModel = ReturnType<typeof useKubernetesNodeTab>
