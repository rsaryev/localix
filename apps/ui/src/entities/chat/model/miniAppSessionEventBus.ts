import type { MiniAppSessionPhase } from '@localixai/mini-app-sdk/ui'

/**
 * Tiny pub/sub carrying the SAFE session lifecycle phases the chat runtime
 * forwards to bridged plugin views (run started/completed/failed). Deliberately
 * separate from the store: it never re-renders anything, it just fans a low-rate
 * signal out to whatever bridged iframes are mounted. Each subscriber (a mounted
 * view's bridge) applies its OWN per-session gate — the bus itself is a plain
 * broadcast, so isolation lives at the edge, not here.
 *
 * Only the phase + session id ride this bus (see `forwardableSessionPhase`);
 * tool payloads, error text and message ids never do.
 */

export interface MiniAppSessionEvent {
  sessionId: string
  phase: MiniAppSessionPhase
}

type Listener = (event: MiniAppSessionEvent) => void

const listeners = new Set<Listener>()

export const miniAppSessionEventBus = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  publish(event: MiniAppSessionEvent): void {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        /* a bridged view's forward must never break the firehose */
      }
    }
  },
}
