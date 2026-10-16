import { create } from 'zustand'
import type { NotificationOrigin } from './notifications/types'

export interface EventFocusRequest {
  token: number
  sessionId: string
  projectId: string | null
  resourceKind: string
  resourceId: string
}

interface EventFocusState {
  pending: EventFocusRequest | null
  /** Recently resolved target, retained briefly so its owner can paint a reveal. */
  active: EventFocusRequest | null
  sequence: number
  request: (origin: Extract<NotificationOrigin, { kind: 'resource' }>) => void
  consume: (token: number) => void
  clearActive: (token: number) => void
}

/**
 * Persistent, typed handoff from the Event Center to feature-owned resource
 * surfaces. The center stays domain-agnostic; each owner consumes only the
 * resource kinds it knows how to reveal.
 */
export const useEventFocusStore = create<EventFocusState>((set) => ({
  pending: null,
  active: null,
  sequence: 0,
  request: (origin) =>
    set((state) => {
      const request = {
        token: state.sequence + 1,
        sessionId: origin.sessionId,
        projectId: origin.projectId,
        resourceKind: origin.resourceKind,
        resourceId: origin.resourceId,
      }
      return {
        sequence: state.sequence + 1,
        pending: request,
        active: request,
      }
    }),
  consume: (token) => set((state) => (state.pending?.token === token ? { pending: null } : state)),
  clearActive: (token) =>
    set((state) => (state.active?.token === token ? { active: null } : state)),
}))

export function requestEventFocus(origin: NotificationOrigin): void {
  if (origin.kind === 'resource') useEventFocusStore.getState().request(origin)
}
