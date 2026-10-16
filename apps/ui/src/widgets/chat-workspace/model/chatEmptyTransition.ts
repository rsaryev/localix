export interface ChatEmptyTransitionSnapshot {
  sessionId: string | null
  hasMessages: boolean
  bodyReady: boolean
}

/**
 * A routed chat is pending until its store row exists and its full body is
 * loaded. By contrast, a surface with no session id is the intentional new-chat
 * draft and may render the greeting immediately.
 *
 * Treating a missing routed row as "ready and empty" flashes EmptyState between
 * the URL/grid switching and the roster/detail response.
 */
export function isChatBodyPending(
  sessionId: string | null,
  session: { bodyLoaded?: boolean } | null | undefined,
): boolean {
  return sessionId !== null && (!session || session.bodyLoaded === false)
}

/**
 * Animate the greeting away only when the first message appears in the same
 * already-loaded empty chat. A transcript arriving after a route/cache/RPC
 * switch must paint directly; overlaying the greeting there is a visible flash.
 */
export function shouldAnimateEmptyDeparture(
  previous: ChatEmptyTransitionSnapshot,
  current: ChatEmptyTransitionSnapshot,
): boolean {
  return (
    previous.sessionId === current.sessionId &&
    previous.bodyReady &&
    !previous.hasMessages &&
    current.hasMessages
  )
}
