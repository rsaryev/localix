import type { NotificationOrigin } from './types'
import { routeEventOrigin } from './origin'

let activeOrigin: NotificationOrigin = { kind: 'application' }
const routeListeners = new Set<(origin: NotificationOrigin) => void>()

/** React Router writes the authoritative visible scope here for non-React publishers. */
export function setActiveEventRoute(pathname: string): void {
  activeOrigin = routeEventOrigin(pathname)
  for (const listener of routeListeners) listener(activeOrigin)
}

export function activeEventOrigin(): NotificationOrigin {
  return activeOrigin
}

/** Told on every route change, with the scope now on screen. */
export function onActiveEventRoute(listener: (origin: NotificationOrigin) => void): () => void {
  routeListeners.add(listener)
  return () => routeListeners.delete(listener)
}

/**
 * Whether an event's chat is the one on screen. ONE rule for everything that asks "has the person
 * seen this?" — the live interruption and the open-chat read (`openChatRead.ts`) used to be free to
 * disagree about it.
 */
export function isOriginOnScreen(origin: NotificationOrigin): boolean {
  return (
    activeOrigin.kind !== 'application' &&
    origin.kind !== 'application' &&
    origin.sessionId === activeOrigin.sessionId
  )
}

export function activeEventResource(
  resourceKind: string,
  resourceId: string,
  label?: string,
): NotificationOrigin {
  return activeOrigin.kind === 'application'
    ? activeOrigin
    : {
        kind: 'resource',
        sessionId: activeOrigin.sessionId,
        projectId: activeOrigin.projectId,
        resourceKind,
        resourceId,
        label,
      }
}

export function resetActiveEventRoute(): void {
  activeOrigin = { kind: 'application' }
}
