import { useCallback } from 'react'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { navigateUi } from '@/shared/lib/uiNavigation'
import { requestEventFocus } from '@/shared/lib/eventFocusBus'
import {
  executeNotificationCommand,
  notificationCommandAvailable,
} from '@/shared/lib/notifications/commandRegistry'
import { originSession } from '@/shared/lib/notifications/origin'
import { recordClientFact } from '@/shared/lib/notifications/clientFacts'
import { addEventTraceStep } from '@/shared/lib/notifications/trace'
import type {
  NotificationAction,
  NotificationEntry,
  NotificationOrigin,
} from '@/shared/lib/notifications/types'

/**
 * What a journal row can DO: open the place an event came from, and run one of its actions.
 *
 * Both close the centre and mark the row read, because both are the person dealing with it. An
 * action that fails is itself journaled — with the row's origin and a trace step per phase — so a
 * Retry that did not work is part of the incident, not a click that went nowhere.
 */
export function useJournalNavigation({
  markRead,
  onRequestClose,
}: {
  markRead: (id: string) => void
  onRequestClose: () => void
}) {
  const nav = useRoutedNavigation()
  // The centre is not inside a conversation, so destinations resolve without one.
  const navigation = useUiNavigation({ sessionId: null })

  const openOrigin = useCallback(
    (origin: NotificationOrigin, entryId: string) => {
      const target = originSession(origin)
      if (!target) return
      markRead(entryId)
      onRequestClose()
      requestEventFocus(origin)
      nav.goToSession(
        target.sessionId,
        target.projectId ? { project: target.projectId } : undefined,
      )
    },
    [markRead, nav, onRequestClose],
  )

  const openSource = useCallback(
    (entry: NotificationEntry) => openOrigin(entry.origin, entry.id),
    [openOrigin],
  )

  const runAction = useCallback(
    async (entry: NotificationEntry, action: NotificationAction) => {
      if (!notificationCommandAvailable(action)) return
      const origin = action.target ?? entry.origin
      const traceId = `event-action:${entry.id}:${action.id}:${Date.now().toString(36)}`
      const step = (phase: 'started' | 'succeeded' | 'failed', errorType?: string) =>
        addEventTraceStep({
          traceId,
          phase,
          kind: 'event.action',
          summary: `${action.label}: ${entry.title}`,
          origin,
          attributes: {
            actionId: action.id,
            actionKind: action.kind,
            ...(errorType ? { errorType } : {}),
          },
        })
      markRead(entry.id)
      step('started')
      try {
        if (action.kind === 'navigate') {
          const target = action.target
          if (action.uri) {
            // The same resolver the transcript's recovery buttons use, so a recovery opens one
            // place whichever surface offered it. An unresolvable URI is a failed action, not a
            // silent no-op.
            onRequestClose()
            if (!navigateUi(action.uri, navigation)) {
              throw new Error(`Nothing can open ${action.uri} here`)
            }
          } else if (target) {
            onRequestClose()
            nav.goToSession(
              target.sessionId,
              target.projectId ? { project: target.projectId } : undefined,
            )
          } else openSource(entry)
        } else if (action.kind === 'invoke') {
          if (action.onClick) await action.onClick()
          else if (!(await executeNotificationCommand(entry, action))) {
            throw new Error(`No handler is registered for ${action.command ?? action.id}`)
          }
        } else {
          await action.onClick?.()
        }
        step('succeeded')
      } catch (error) {
        step('failed', error instanceof Error ? error.name : typeof error)
        recordClientFact({
          severity: 'error',
          title: `Could not run “${action.label}”`,
          body: errorMessage(error, 'The action could not be completed'),
          origin,
          nativeKind: 'run',
        })
      }
    },
    [markRead, nav, navigation, onRequestClose, openSource],
  )

  return { openOrigin, openSource, runAction }
}
