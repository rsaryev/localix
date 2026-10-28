import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
import type { ContainerStats, ContainerTop, DockerContainer } from '../../backend/contracts'
import { DockerApiError, dockerApi } from '../dockerApi'
import type { DevOpsIssue } from '../../../ui/DevOpsProblem'
import { dockerIssue } from './dockerIssue'
import { mergeLogSnapshots } from '../../../ui/model/logStream'
import { appendStatSample, statSampleOf, type StatSample } from './statsHistory'
import { containerPollNeeded, sameContainer, type DockerContainerPanel } from './containerPanel'
import { createEventRefreshBatcher, useDockerEvents } from './dockerEventsClient'
import { useLogFollow } from '../../../ui/model/logFollowFeed'
import { useStableCallback } from '@localixai/mini-app-sdk/ui/runtime-hooks'

type LogResult =
  | { status: 'ok'; lines: string }
  | { status: 'error'; error: unknown }
  | { status: 'skipped' }

type PanelResult =
  | { kind: 'stats'; status: 'ok'; value: ContainerStats | null }
  | { kind: 'top'; status: 'ok'; value: ContainerTop | null }
  | { kind: 'stats' | 'top'; status: 'error'; error: unknown }
  | { kind: 'skipped' }

function readLogs(containerId: string, include: boolean, incremental: boolean): Promise<LogResult> {
  if (!include) return Promise.resolve({ status: 'skipped' })
  return dockerApi.logs(containerId, 2_000, incremental ? 6 : undefined).then(
    (result) => ({ status: 'ok', lines: result?.lines ?? '' }),
    (error: unknown) => ({ status: 'error', error }),
  )
}

function readPanel(containerId: string, panel: DockerContainerPanel): Promise<PanelResult> {
  if (panel === 'stats') {
    return dockerApi.stats(containerId).then(
      (value) => ({ kind: 'stats', status: 'ok', value }),
      (error: unknown) => ({ kind: 'stats', status: 'error', error }),
    )
  }
  if (panel === 'top') {
    return dockerApi.top(containerId).then(
      (value) => ({ kind: 'top', status: 'ok', value }),
      (error: unknown) => ({ kind: 'top', status: 'error', error }),
    )
  }
  return Promise.resolve({ kind: 'skipped' })
}

function panelError(error: unknown, panel: 'stats' | 'top'): DevOpsIssue {
  if (error instanceof DockerApiError) return dockerIssue(error)
  return {
    message:
      panel === 'stats' ? 'Could not sample the container stats.' : 'Could not read the processes.',
  }
}

/** Target-scoped container snapshot plus panel-aware polling. */
export function useDockerContainerData({
  active,
  containerId,
  panel,
}: {
  active: boolean
  containerId: string
  panel: DockerContainerPanel
}) {
  const [container, setContainer] = useState<DockerContainer | null>(null)
  const [logs, setLogs] = useState('')
  const [logsError, setLogsError] = useState<string | null>(null)
  const [stats, setStats] = useState<ContainerStats | null>(null)
  const [statsError, setStatsError] = useState<DevOpsIssue | null>(null)
  const [statsHistory, setStatsHistory] = useState<readonly StatSample[]>([])
  const [top, setTop] = useState<ContainerTop | null>(null)
  const [topError, setTopError] = useState<DevOpsIssue | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logsLive, setLogsLive] = useState(true)
  const refreshSeq = useRef(0)
  const logSeq = useRef(0)
  const logStreamKey = useRef('')
  const resetTargetRef = useRef('')
  const immediateRefreshKeyRef = useRef('')

  const refresh = useCallback(
    async (requestedPanel: DockerContainerPanel, includeLogs: boolean) => {
      const seq = ++refreshSeq.current
      const requestedLogSeq = includeLogs ? ++logSeq.current : null
      const incrementalLogs = includeLogs && logStreamKey.current === containerId
      try {
        const [containers, logResult, panelResult] = await Promise.all([
          dockerApi.listContainers(),
          readLogs(containerId, includeLogs, incrementalLogs),
          readPanel(containerId, requestedPanel),
        ])
        if (seq !== refreshSeq.current) return

        const match =
          containers.find(
            (candidate) => candidate.id === containerId || candidate.id.startsWith(containerId),
          ) ?? null
        setContainer(match)
        if (logResult.status === 'ok' && requestedLogSeq === logSeq.current) {
          setLogs((current) =>
            incrementalLogs ? mergeLogSnapshots(current, logResult.lines) : logResult.lines,
          )
          logStreamKey.current = containerId
          setLogsError(null)
        } else if (logResult.status === 'error' && requestedLogSeq === logSeq.current) {
          setLogsError(
            logResult.error instanceof DockerApiError
              ? logResult.error.message
              : 'Could not load the container logs.',
          )
        }
        setError(match ? null : 'Container no longer exists.')

        const running = match?.state === 'running' || match?.state === 'restarting'
        if (match && running) {
          if (panelResult.kind === 'stats' && panelResult.status === 'ok') {
            setStats(panelResult.value)
            setStatsError(null)
            const sample = statSampleOf(panelResult.value, Date.now())
            if (sample) {
              setStatsHistory((history) => appendStatSample(history, sample))
            }
          } else if (panelResult.kind === 'stats') {
            setStatsError(panelError(panelResult.error, 'stats'))
          } else if (panelResult.kind === 'top' && panelResult.status === 'ok') {
            setTop(panelResult.value)
            setTopError(null)
          } else if (panelResult.kind === 'top') {
            setTopError(panelError(panelResult.error, 'top'))
          }
        } else {
          setStats(null)
          setStatsError(null)
          setStatsHistory([])
          setTop(null)
          setTopError(null)
        }
      } catch (cause) {
        if (seq !== refreshSeq.current) return
        setError(cause instanceof DockerApiError ? cause.message : 'Could not reach Docker.')
      } finally {
        if (seq === refreshSeq.current) setLoading(false)
      }
    },
    [containerId],
  )

  useEffect(() => {
    if (resetTargetRef.current === containerId) return
    resetTargetRef.current = containerId
    refreshSeq.current += 1
    logSeq.current += 1
    logStreamKey.current = ''
    setContainer(null)
    setLogs('')
    setLogsError(null)
    setStats(null)
    setStatsError(null)
    setStatsHistory([])
    setTop(null)
    setTopError(null)
    setError(null)
    setLoading(true)
    setLogsLive(true)
  }, [containerId])

  useEffect(() => {
    if (!active) {
      immediateRefreshKeyRef.current = ''
      return
    }
    if (panel === 'logs' && !logsLive) return
    const key = `${containerId}/${panel}/${logsLive}`
    if (immediateRefreshKeyRef.current === key) return
    immediateRefreshKeyRef.current = key
    void refresh(panel, panel === 'logs')
  }, [active, containerId, panel, logsLive, refresh])

  // The container's own events (a stop, a start, a restart) re-read it at once.
  const readLatest = useStableCallback(() => void refresh(panel, panel === 'logs' && logsLive))
  const eventsBatcher = useMemo(
    () =>
      createEventRefreshBatcher<'read'>(
        () => readLatest(),
        () => 'read',
      ),
    [readLatest],
  )
  useEffect(() => eventsBatcher.cancel, [eventsBatcher])
  const eventsLive = useDockerEvents(active, {
    event: (frame) => {
      if (frame.type === 'container' && sameContainer(frame.id, containerId)) {
        eventsBatcher.push('read')
      }
    },
    resync: () => eventsBatcher.push('read'),
  })

  // A running container's live log view follows the log: new lines are read when they arrive.
  const following =
    active &&
    panel === 'logs' &&
    logsLive &&
    (container?.state === 'running' || container?.state === 'restarting')
  const logsFollowed = useLogFollow(following ? { provider: 'docker', containerId } : null, () =>
    eventsBatcher.push('read'),
  )

  useVisiblePolling({
    enabled:
      active &&
      containerPollNeeded({
        live: eventsLive,
        panel,
        logsLive,
        state: container?.state ?? null,
        logsFollowed,
      }),
    intervalMs: 3000,
    onTick: () => refresh(panel, panel === 'logs' && logsLive),
    immediate: false,
    resetKey: `${containerId}/${panel}/${logsLive}`,
  })

  const setLogPlayback = useCallback((live: boolean) => {
    if (!live) {
      logSeq.current += 1
      logStreamKey.current = ''
    }
    setLogsLive(live)
  }, [])

  return {
    container,
    logs,
    logsError,
    stats,
    statsError,
    statsHistory,
    top,
    topError,
    loading,
    error,
    logsLive,
    refresh,
    setLogPlayback,
  }
}
