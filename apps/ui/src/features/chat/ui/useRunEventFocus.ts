/**
 * WHETHER ONE MESSAGE is the run the Event Center just asked to reveal — and for how long.
 *
 * The request stays `active` in the store until someone clears it, so a card that painted the
 * reveal and never cleared it would keep it on for as long as it stayed mounted, and every later
 * jump to the same run would find it already lit. The reveal therefore owns its own end: the
 * owner that paints it clears it by token after a beat, and a newer request (another token) is
 * left alone. Its tool-level counterpart is `tool-parts/eventFocusTarget.ts`, whose owner
 * (`ItemView`) ends its reveal through the same `useRevealEnd`.
 */
import { useEffect } from 'react'
import { useEventFocusStore, type EventFocusRequest } from '@/shared/lib/eventFocusBus'

const REVEAL_MS = 1_600

/**
 * End a reveal this component painted: clear `focus` by its token after one beat. Every owner of
 * a reveal uses this one, so the beat is one length and a newer request is never cleared early.
 */
export function useRevealEnd(focus: EventFocusRequest | null): void {
  useEffect(() => {
    if (!focus) return
    const timer = window.setTimeout(
      () => useEventFocusStore.getState().clearActive(focus.token),
      REVEAL_MS,
    )
    return () => window.clearTimeout(timer)
  }, [focus])
}

/** `enabled` is the caller's gate — a hidden warm transcript, or a row with no session. */
export function useRunEventFocus(
  sessionId: string | null | undefined,
  messageId: string,
  enabled: boolean,
): EventFocusRequest | null {
  const focus = useEventFocusStore((state) =>
    enabled &&
    state.active?.resourceKind === 'run' &&
    state.active.sessionId === sessionId &&
    state.active.resourceId === messageId
      ? state.active
      : null,
  )
  useRevealEnd(focus)
  return focus
}
