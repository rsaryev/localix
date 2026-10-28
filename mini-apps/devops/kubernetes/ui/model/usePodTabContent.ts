import { useCallback, useEffect, useRef, useState } from 'react'
import type { KubeEvent, KubePod } from '../../backend/contracts'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
import { kubernetesApi } from '../api/kubernetesApi'
import { KubeApiError } from '../api/transport'
import { ALL_CONTAINERS, logRequestFor } from './podContainers'
import type { PodTabView } from './podTabView'
import { mergeLogSnapshots } from '../../../ui/model/logStream'
import { useLogFollow, type LogFollowTarget } from '../../../ui/model/logFollowFeed'

interface PodTabContentOptions {
  active: boolean
  podName: string
  namespace: string
  context?: string
  pod: KubePod | null
  view: PodTabView
  container: string
}

/** The poll a live log view keeps: none while the log is followed, or for a finished instance. */
export function podLogPollMs(input: { followed: boolean; previous: boolean }): number | null {
  return input.followed || input.previous ? null : 3000
}

/** What to follow for the selected container; the interleaved view follows every app container. */
export function logFollowTargetOf(input: {
  following: boolean
  context?: string
  namespace: string
  podName: string
  pod: KubePod | null
  container: string
}): LogFollowTarget | null {
  if (!input.following || !input.pod) return null
  const selected = input.container || input.pod.containers[0] || ''
  const containers = selected === ALL_CONTAINERS ? input.pod.containers : [selected]
  if (containers.length === 0 || containers.some((name) => !name)) return null
  return {
    provider: 'k8s',
    context: input.context ?? '',
    namespace: input.namespace,
    pod: input.podName,
    containers,
  }
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
  // The pod the next read names its default container after; read when a read runs, so a pod
  // update does not re-create `refreshView` and restart the poll.
  const podRef = useRef(pod)
  useEffect(() => {
    podRef.current = pod
  }, [pod])

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

  // The current instance's live log view follows the log: new lines are read when they arrive.
  // A previous instance's log is finished — read once, never polled.
  const followTarget = logFollowTargetOf({
    following: active && view === 'logs' && logsLive && !previousLogs,
    context,
    namespace,
    podName,
    pod,
    container,
  })
  const followed = useLogFollow(followTarget, () => void refreshView())

  useVisiblePolling({
    enabled: active && view === 'logs' && logsLive,
    intervalMs: podLogPollMs({ followed, previous: previousLogs }),
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
