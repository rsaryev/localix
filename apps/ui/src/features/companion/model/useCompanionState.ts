import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/features/chat/model/store'
import { backendClient } from '@/shared/api/client'
import type { Project, UiSession } from '@/shared/api/contracts'
import { eventSocket } from '@/shared/api/eventSocket'
import { resourceSync } from '@/shared/api/resourceSync'
import { startResourceSyncTransport } from '@/shared/api/resourceSyncTransport'
import {
  applyAttentionRoster,
  loadAttention,
  useAttentionStore,
} from '@/features/chat/model/attention/store'
import { reconcileSessionListAfterReconnect } from '@/features/chat/model/reconnect-session-list'
import { applyCompanionEvent } from './roster'

export function useCompanionState() {
  const [sessions, setSessions] = useState<readonly UiSession[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [connected, setConnected] = useState(eventSocket.isConnected)
  const held = useRef(sessions)
  const refreshRef = useRef<() => void>(() => {})
  const items = useAttentionStore((state) => state.items)

  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    const abort = new AbortController()
    let generation = 0
    const update = (next: readonly UiSession[]) => {
      held.current = next
      setSessions(next)
    }
    const read = async () => {
      const request = ++generation
      const before = held.current
      const results = await Promise.allSettled([
        backendClient.listSessions(abort.signal),
        backendClient.listProjects(abort.signal),
        loadAttention(),
      ])
      if (abort.signal.aborted || request !== generation) return
      const [roster, projectList, attention] = results
      if (roster.status === 'fulfilled') {
        update(reconcileSessionListAfterReconnect(before, held.current, roster.value))
      }
      if (projectList.status === 'fulfilled') setProjects(projectList.value)
      setError(
        roster.status === 'rejected' ||
          projectList.status === 'rejected' ||
          attention.status === 'rejected' ||
          !attention.value,
      )
      setLoading(false)
    }
    refreshRef.current = () => void read()
    const stops = [
      resourceSync.register('providers', {
        read: (signal) => backendClient.listConnections(signal),
        apply: (connections) => useChatStore.setState({ connections }),
        onError: () => setError(true),
      }),
      eventSocket.onConnected(() => {
        setConnected(true)
        void read()
      }),
      eventSocket.onDisconnect(() => setConnected(false)),
      resourceSync.register('sessions', {
        read: async (signal) => ({
          before: held.current,
          sessions: await backendClient.listSessions(signal),
        }),
        apply: (result) =>
          update(reconcileSessionListAfterReconnect(result.before, held.current, result.sessions)),
        onError: () => setError(true),
      }),
      resourceSync.register('projects', {
        read: (signal) => backendClient.listProjects(signal),
        apply: setProjects,
        onError: () => setError(true),
      }),
      startResourceSyncTransport(),
      eventSocket.onSessionEvent((sessionId, event) => {
        if (event.type === 'attention.updated') applyAttentionRoster(event.items)
        else {
          const next = applyCompanionEvent(held.current, sessionId, event)
          if (next !== held.current) update(next)
        }
      }),
    ]
    void read()
    return () => {
      abort.abort()
      refreshRef.current = () => {}
      for (const stop of stops) stop()
    }
  }, [])

  return { sessions, projects, items, loading, error, connected, refresh }
}
