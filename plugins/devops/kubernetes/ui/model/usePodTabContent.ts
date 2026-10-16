import { useCallback, useEffect, useRef, useState } from 'react'
import type { KubeEvent, KubePod } from '../../backend/contracts'
import { useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'
import { kubernetesApi } from '../api/kubernetesApi'
import { KubeApiError } from '../api/transport'
import { ALL_CONTAINERS, logRequestFor } from './podContainers'
import type { PodTabView } from './podTabView'
import { mergeLogSnapshots } from '../../../ui/model/logStream'

interface PodTabContentOptions {
  active: boolean
  podName: string
  namespace: string
  context?: string
  pod: KubePod | null
  view: PodTabView
  container: string
}

/** Fetch and sequence the selected pod view, keeping log snapshots race-safe and bounded. */
export function usePodTabContent(options: PodTabContentOptions) {
  const { active, podName, namespace, context, pod, view, container } = options
  const [logs, setLogs] = useState('')
  const [describe, setDescribe] = useState('')
  const [events, setEvents] = useState<KubeEvent[]>([])
  const [viewError, setViewError] = useState<string | null>(null)
  const [logsLive, setLogsLive] = useState(true)
  const [previousLogs, setPreviousLogs] = useState(false)
  const viewSeq = useRef(0)
  const logStreamKey = useRef('')
  const podRef = useRef(pod)
  podRef.current = pod

  const refreshView = useCallback(async () => {
    const seq = ++viewSeq.current
    try {
      if (view === 'logs') {
        const selectedContainer = container || podRef.current?.containers[0] || ''
        const streamKey = [
          context ?? '',
          namespace,
          podName,
          selectedContainer,
          String(previousLogs),
        ].join('/')
        // Interleaved all-container logs need a whole tail: a continuation line may outlive the
        // stamped line that gives it a sortable position.
        const incremental =
          !previousLogs &&
          selectedContainer !== ALL_CONTAINERS &&
          logStreamKey.current === streamKey
        const response = await kubernetesApi.logs(podName, {
          namespace,
          context: context || undefined,
          ...logRequestFor(selectedContainer),
          tail: 2_000,
          sinceSeconds: incremental ? 6 : undefined,
          previous: previousLogs,
        })
        if (seq !== viewSeq.current) return
        setLogs((current) =>
          incremental ? mergeLogSnapshots(current, response?.lines ?? '') : (response?.lines ?? ''),
        )
        logStreamKey.current = streamKey
      } else if (view === 'describe') {
        const response = await kubernetesApi.describe(podName, namespace, context || undefined)
        if (seq !== viewSeq.current) return
        setDescribe(response?.text ?? '')
      } else if (view === 'events') {
        const response = await kubernetesApi.events(podName, namespace, context || undefined)
        if (seq !== viewSeq.current) return
        setEvents(response ?? [])
      }
      if (seq === viewSeq.current) setViewError(null)
    } catch (cause) {
      if (seq !== viewSeq.current) return
      setViewError(cause instanceof KubeApiError ? cause.message : `Could not load ${view}.`)
    }
  }, [container, context, namespace, podName, previousLogs, view])

  useEffect(() => {
    if (active && view !== 'logs') void refreshView()
  }, [active, refreshView, view])

  const resetTarget = `${context ?? ''}/${namespace}/${podName}/${container}`
  const resetTargetRef = useRef('')
  useEffect(() => {
    if (resetTargetRef.current === resetTarget) return
    resetTargetRef.current = resetTarget
    viewSeq.current += 1
    setLogs('')
    logStreamKey.current = ''
    setViewError(null)
    setLogsLive(true)
    setPreviousLogs(false)
  }, [resetTarget])

  useVisiblePolling({
    enabled: active && view === 'logs' && logsLive,
    intervalMs: 3000,
    onTick: refreshView,
    immediate: true,
    resetKey: `${podName}/${namespace}/${context ?? ''}/${container}/${previousLogs}`,
  })

  const setLogPlayback = useCallback((live: boolean) => {
    if (!live) {
      viewSeq.current += 1
      logStreamKey.current = ''
    }
    setLogsLive(live)
  }, [])

  const togglePreviousLogs = useCallback(() => {
    viewSeq.current += 1
    setLogs('')
    setViewError(null)
    setPreviousLogs((value) => !value)
    setLogsLive(true)
  }, [])

  return {
    logs,
    describe,
    events,
    viewError,
    logsLive,
    previousLogs,
    refreshView,
    setLogPlayback,
    togglePreviousLogs,
  }
}
