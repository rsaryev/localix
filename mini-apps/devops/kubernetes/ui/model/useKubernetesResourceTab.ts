import { useCallback, useEffect, useRef, useState } from 'react'
import {
  enqueueMicrotask,
  resourceMessageBindingDraft,
  type PublishMessageContext,
} from '@localixai/mini-app-sdk/ui'
import type { KubeDeployment, KubeEvent, KubePod, KubeResourceKind } from '../../backend/contracts'
import { kubernetesApi } from '../api/kubernetesApi'
import { KubeApiError } from '../api/transport'
import { buildK8sWorkloadUri, buildK8sWorkloadViewUri } from './resourceLink'

export type KubernetesResourceView = 'describe' | 'pods' | 'events' | 'manifest'

export function useKubernetesResourceTab({
  active,
  resourceKind,
  name,
  namespace,
  context,
  publishMessageContext,
}: {
  active: boolean
  resourceKind: KubeResourceKind
  name: string
  namespace: string
  context?: string
  publishMessageContext?: PublishMessageContext
}) {
  const [view, setView] = useState<KubernetesResourceView>('describe')
  const [describe, setDescribe] = useState('')
  const [events, setEvents] = useState<KubeEvent[]>([])
  const [pods, setPods] = useState<KubePod[]>([])
  const [deployment, setDeployment] = useState<KubeDeployment | null>(null)
  const [scaling, setScaling] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const viewSeq = useRef(0)
  const deploymentSeq = useRef(0)
  const resolvedContext = context || undefined
  const resourceUri = buildK8sWorkloadUri({
    context,
    namespace,
    kind: resourceKind,
    name,
  })

  useEffect(() => {
    if (!publishMessageContext || !name || !namespace) return
    const uri =
      view === 'pods'
        ? resourceUri
        : buildK8sWorkloadViewUri({
            context,
            namespace,
            kind: resourceKind,
            name,
            view,
          })
    publishMessageContext({
      strategy: 'replace',
      bindings: [resourceMessageBindingDraft({ uri, label: `${name} ${view}` })],
    })
  }, [context, name, namespace, publishMessageContext, resourceKind, resourceUri, view])

  const loadDeployment = useCallback(async () => {
    const seq = ++deploymentSeq.current
    if (resourceKind !== 'deployment') {
      setDeployment(null)
      return
    }
    try {
      const deployments = await kubernetesApi.listDeployments(namespace, resolvedContext)
      if (seq !== deploymentSeq.current) return
      setDeployment(deployments.find((candidate) => candidate.name === name) ?? null)
    } catch {
      if (seq === deploymentSeq.current) setDeployment(null)
    }
  }, [resourceKind, name, namespace, resolvedContext])

  const refresh = useCallback(async () => {
    const seq = ++viewSeq.current
    if (view === 'manifest') {
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      if (view === 'describe') {
        const result = await kubernetesApi.describeResource(
          resourceKind,
          name,
          namespace,
          resolvedContext,
        )
        if (seq !== viewSeq.current) return
        setDescribe(result?.text ?? '')
      } else if (view === 'pods') {
        const result = await kubernetesApi.deploymentPods(name, namespace, resolvedContext)
        if (seq !== viewSeq.current) return
        setPods(result ?? [])
      } else {
        const result = await kubernetesApi.resourceEvents(
          resourceKind,
          name,
          namespace,
          resolvedContext,
        )
        if (seq !== viewSeq.current) return
        setEvents(result ?? [])
      }
      setError(null)
    } catch (cause) {
      if (seq !== viewSeq.current) return
      setError(cause instanceof KubeApiError ? cause.message : 'Could not reach the cluster.')
    } finally {
      if (seq === viewSeq.current) setLoading(false)
    }
  }, [resourceKind, name, namespace, resolvedContext, view])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    enqueueMicrotask(() => {
      if (!cancelled) void refresh()
    })
    return () => {
      cancelled = true
      viewSeq.current += 1
    }
  }, [active, refresh])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    enqueueMicrotask(() => {
      if (!cancelled) void loadDeployment()
    })
    return () => {
      cancelled = true
      deploymentSeq.current += 1
    }
  }, [active, loadDeployment])

  return {
    view,
    setView,
    describe,
    events,
    pods,
    deployment,
    scaling,
    openScale: () => setScaling(true),
    closeScale: () => setScaling(false),
    loading,
    error,
    resourceUri,
    resolvedContext,
    refresh,
    loadDeployment,
  }
}

export type KubernetesResourceTabModel = ReturnType<typeof useKubernetesResourceTab>
