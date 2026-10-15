import { useEffect, useRef } from 'react'
import {
  createJournalIncident,
  type JournalIncident,
} from '@/shared/lib/notifications/journalIncident'
import { activeEventOrigin } from '@/shared/lib/notifications/context'
import type { NotificationOrigin } from '@/shared/lib/notifications/types'

/**
 * One incident lifecycle spans every reconnect effect generation. Keeping it
 * outside the socket effect lets six bounded attempts become one causal trace
 * instead of six noisy rows; a stable open reports recovery, while unmount or
 * an authoritative dead PTY abandons the transport incident.
 */
export function useTerminalConnectionIncident(sessionId: string, terminalId: string) {
  const incidentRef = useRef<JournalIncident | null>(null)
  useEffect(() => {
    const routeOrigin = activeEventOrigin()
    const origin: NotificationOrigin = sessionId
      ? {
          kind: 'resource',
          sessionId,
          projectId:
            routeOrigin.kind !== 'application' && routeOrigin.sessionId === sessionId
              ? routeOrigin.projectId
              : null,
          resourceKind: 'terminal',
          resourceId: terminalId,
          label: 'Terminal',
        }
      : { kind: 'application', label: 'Terminal' }
    const incident = createJournalIncident({
      kind: 'terminal.connection',
      origin,
      unavailable: {
        severity: 'warning',
        title: 'Terminal connection unavailable',
        message:
          'The terminal stream could not reconnect. The backend process may still be running.',
      },
      recovered: {
        severity: 'success',
        title: 'Terminal connection restored',
        message: 'The terminal stream is interactive again.',
      },
    })
    incidentRef.current = incident
    return () => {
      incident.abandon()
      if (incidentRef.current === incident) incidentRef.current = null
    }
  }, [sessionId, terminalId])
  return incidentRef
}
