/**
 * OPEN registry of plugin-contributed session-stream event handlers — the UI
 * counterpart of a plugin backend's own stream frames (e.g. `<domain>.updated`).
 * The chat runtime's demultiplexer dispatches an event type here AFTER its
 * built-in routes: a contributed type is consumed by its handlers and does not
 * reach the generic store reducer. Registration comes through the PluginUiHost
 * (`host.sessionEvents.register`) from a plugin's `ui/register.tsx`.
 */

export type SessionEventHandler = (sessionId: string, event: unknown) => void
import { isPluginContributionEnabled } from './pluginActivation'

interface RegisteredHandler {
  handler: SessionEventHandler
  pluginName?: string
}

const handlers = new Map<string, RegisteredHandler[]>()

/** Register a handler for a session-stream event type core does not route itself. */
export function registerSessionEventHandler(
  type: string,
  handler: SessionEventHandler,
  pluginName?: string,
): void {
  const list = handlers.get(type) ?? []
  list.push({ handler, pluginName })
  handlers.set(type, list)
}

/** Handlers contributed for an event type (empty array when none). */
/** Drop every handler `owner` registered (a plugin reload or unload). */
export function removeSessionEventHandlersOf(owner: string): void {
  for (const [type, list] of handlers) {
    const kept = list.filter((entry) => entry.pluginName !== owner)
    if (kept.length) handlers.set(type, kept)
    else handlers.delete(type)
  }
}

export function sessionEventHandlersFor(type: string): SessionEventHandler[] {
  return (handlers.get(type) ?? []).flatMap((entry) =>
    isPluginContributionEnabled(entry.pluginName) ? [entry.handler] : [],
  )
}
