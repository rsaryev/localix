import { useCallback, useEffect, useMemo, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import { resourceSync } from '@/shared/api/resourceSync'
import { startResourceSyncTransport } from '@/shared/api/resourceSyncTransport'
import {
  applyAttentionRoster,
  loadAttention,
  useAttentionStore,
} from '@/entities/chat/model/attention/store'
import {
  anyRunning,
  applyRunEvent,
  briefsFrom,
  islandRequests,
  type SessionBriefs,
} from './requests'

/**
 * What the island reads, and nothing else: the requests waiting on the person (the server's
 * attention roster, mirrored in this window's store) and whether any conversation is running.
 * It re-reads on every poke and on every reconnect, and writes nothing back: a request this window
 * just answered is only hidden here (request keys are unique, so it never needs un-hiding).
 */
export function useIslandRequests() {
  const items = useAttentionStore((state) => state.items)
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set())
  const [briefs, setBriefs] = useState<SessionBriefs>(new Map())

  useEffect(() => {
    const abort = new AbortController()
    const readRunning = async () => {
      try {
        const sessions = await backendClient.listSessions(abort.signal)
        if (!abort.signal.aborted) {
          setBriefs(briefsFrom(sessions))
        }
      } catch {
        /* keep what the stream says; the next poke reads again */
      }
    }
    const stops = [
      eventSocket.onConnected(() => {
        void loadAttention()
        void readRunning()
      }),
      resourceSync.register('sessions', {
        read: (signal) => backendClient.listSessions(signal),
        apply: (sessions) => setBriefs(briefsFrom(sessions)),
        onError: () => {},
      }),
      startResourceSyncTransport(),
      eventSocket.onSessionEvent((sessionId, event) => {
        if (event.type === 'attention.updated') applyAttentionRoster(event.items)
        else setBriefs((current) => applyRunEvent(current, sessionId, event))
      }),
    ]
    void loadAttention()
    void readRunning()
    return () => {
      abort.abort()
      for (const stop of stops) stop()
    }
  }, [])

  const requests = useMemo(() => islandRequests(items, settled), [items, settled])
  const settle = useCallback(
    (key: string) => setSettled((current) => new Set([...current, key])),
    [],
  )
  return { requests, briefs, working: anyRunning(briefs), settle }
}
