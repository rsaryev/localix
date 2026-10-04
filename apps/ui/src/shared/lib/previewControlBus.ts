import type { PreviewCommand } from '@/shared/api/contracts'

/**
 * Agnostic pub/sub for agent-driven preview control. A `preview.command` firehose
 * event is routed here (not into the chat store — it's a transient request, not
 * session state); the open PreviewTab subscribes for its session, executes the
 * command against the probe, and replies via the `preview-result` WS RPC. Mirrors
 * `composerBus` — keeps the inspector decoupled from the store.
 */

export interface PreviewCommandEvent {
  sessionId: string
  commandId: string
  command: PreviewCommand
}

type Listener = (event: PreviewCommandEvent) => void

const listeners = new Set<Listener>()
const pending = new Map<string, { event: PreviewCommandEvent; at: number }>()

export const previewControlBus = {
  /** Subscribe to all preview commands; filter by sessionId in the listener. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    for (const [id, entry] of pending) {
      if (Date.now() - entry.at > 22_000) pending.delete(id)
      else listener(entry.event)
    }
    return () => listeners.delete(listener)
  },
  publish(event: PreviewCommandEvent): void {
    pending.set(event.commandId, { event, at: Date.now() })
    if (pending.size > 100) pending.delete(pending.keys().next().value!)
    // Snapshot the set: a subscriber may subscribe or unsubscribe from inside its own
    // handler, and iterating the live Set would deliver this same event to a listener that
    // only just arrived.
    for (const l of Array.from(listeners)) {
      try {
        l(event)
      } catch {
        /* never let one subscriber break the fan-out */
      }
    }
  },
  /** A successfully claimed command is no longer waiting for a host. */
  acknowledge(commandId: string): void {
    pending.delete(commandId)
  },
}
