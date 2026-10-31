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

/**
 * How long a command waits for a preview to open and claim it. The API's preview command registry
 * gives up on an unclaimed command after the same 22 s (its `DEFAULT_TIMEOUT_MS`), so a later
 * replay would run a command nobody is waiting for.
 */
const PENDING_COMMAND_TTL_MS = 22_000
/** Unclaimed commands kept at most; the oldest goes first. */
const PENDING_COMMAND_CAP = 100

const listeners = new Set<Listener>()
const pending = new Map<string, { event: PreviewCommandEvent; at: number }>()

export const previewControlBus = {
  /** Subscribe to all preview commands; filter by sessionId in the listener. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    for (const [id, entry] of pending) {
      if (Date.now() - entry.at > PENDING_COMMAND_TTL_MS) pending.delete(id)
      else listener(entry.event)
    }
    return () => listeners.delete(listener)
  },
  publish(event: PreviewCommandEvent): void {
    pending.set(event.commandId, { event, at: Date.now() })
    if (pending.size > PENDING_COMMAND_CAP) pending.delete(pending.keys().next().value!)
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
