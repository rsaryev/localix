/**
 * OPEN registry of mini-app-contributed session-stream event handlers — the UI
 * counterpart of a mini app backend's own stream frames (e.g. `<domain>.updated`).
 * The chat runtime's demultiplexer dispatches an event type here AFTER its
 * built-in routes: a contributed type is consumed by its handlers and does not
 * reach the generic store reducer. Registration comes through the MiniAppUiHost
 * (`host.sessionEvents.register`) from a mini app's `ui/register.tsx`.
 */

export type SessionEventHandler = (sessionId: string, event: unknown) => void
import { isMiniAppContributionEnabled } from './miniAppActivation'

interface RegisteredHandler {
  handler: SessionEventHandler
  miniAppName?: string
}

const handlers = new Map<string, RegisteredHandler[]>()

/** Register a handler for a session-stream event type core does not route itself. */
export function registerSessionEventHandler(
  type: string,
  handler: SessionEventHandler,
  miniAppName?: string,
): void {
  const list = handlers.get(type) ?? []
  list.push({ handler, miniAppName })
  handlers.set(type, list)
}

/** Handlers contributed for an event type (empty array when none). */
/** Drop every handler `owner` registered (a mini app reload or unload). */
export function removeSessionEventHandlersOf(owner: string): void {
  for (const [type, list] of handlers) {
    const kept = list.filter((entry) => entry.miniAppName !== owner)
    if (kept.length) handlers.set(type, kept)
    else handlers.delete(type)
  }
}

export function sessionEventHandlersFor(type: string): SessionEventHandler[] {
  return (handlers.get(type) ?? []).flatMap((entry) =>
    isMiniAppContributionEnabled(entry.miniAppName) ? [entry.handler] : [],
  )
}
