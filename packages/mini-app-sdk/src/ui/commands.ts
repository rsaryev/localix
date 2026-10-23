/**
 * Singleton registry + dispatcher for `mini-app.command` session-stream frames — the
 * typed channel for mini app→UI COMMANDS. A mini app's
 * `ui/register.tsx` registers a sink for its (mini app, channel) key; the chat
 * runtime's demultiplexer publishes every `mini-app.command` frame here.
 *
 * Three properties a coalescing data bus (the retired `ui.data` path) cannot give a command:
 * - NON-COALESCING — every command is delivered, in stream order (no 32 ms
 *   drop-to-latest that can swallow one of two near-simultaneous commands);
 * - REPLAY-SAFE — the frame is replayable server-side, so a reconnecting client
 *   still receives it; delivery here dedups by `commandId`, so a replayed frame
 *   is applied at most once per page session;
 * - SESSION-AWARE — each delivery carries the originating session id and whether
 *   that session is the ACTIVE one, so a sink can apply the focus policy
 *   ("background sessions must not steal focus") without importing the chat store.
 */

export interface MiniAppCommandEvent {
  /** The session whose agent issued the command. */
  sessionId: string
  /** True when that session is the one on screen — the sink's focus-policy input. */
  active: boolean
  /** Opaque mini app payload — the sink parses it with its own structural guard. */
  payload: unknown
  commandId: string
  seq: number
  /**
   * Answer an AWAITED command (`emitCommandWithReply` on the backend): the stream
   * router binds it to this frame's `commandId` and relays it over the
   * `mini-app-command-result` WS RPC to settle the server-side pending promise.
   * A sink that has nothing to say simply never calls it — the server times out
   * to an honest `noReply`. Dedup above guarantees at most one delivery per
   * commandId, so a replayed frame can never double-reply.
   */
  reply?: (payload: MiniAppCommandReply) => void
}

/** A sink's answer to one awaited command. `result` is the mini app's own shape. */
export interface MiniAppCommandReply {
  ok: boolean
  result?: unknown
  error?: string
}

/** The `mini-app.command` frame as the stream router hands it over (sans `type`). */
export interface MiniAppCommandFrame {
  sessionId: string
  miniApp: string
  channel: string
  payload: unknown
  commandId: string
  seq: number
}

type Handler = (event: MiniAppCommandEvent) => void

const key = (miniApp: string, channel: string) => `${miniApp}:${channel}`

const handlers = new Map<string, Set<Handler>>()

// Command ids already applied this page session — an SSE replay on reconnect
// re-delivers replayable frames, and a command (open a tab, change a timeframe)
// must not re-run. Capped like the router's other per-page guards.
const appliedCommandIds = new Set<string>()
const MAX_APPLIED_IDS = 500

export const miniAppCommandBus = {
  /** Register a sink for one (mini app, channel) key. Returns the unsubscribe. */
  register(miniApp: string, channel: string, handler: Handler): () => void {
    const k = key(miniApp, channel)
    let set = handlers.get(k)
    if (!set) {
      set = new Set()
      handlers.set(k, set)
    }
    set.add(handler)
    return () => {
      const current = handlers.get(k)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) handlers.delete(k)
    }
  },

  /**
   * Dispatch one frame to its (mini app, channel) sinks. `active` is computed by the
   * caller (the stream router) against the chat store. A frame whose `commandId`
   * was already applied (replay) is dropped; a frame with no registered sink is
   * dropped too — core cannot queue for a mini app UI that never registered.
   */
  publish(
    frame: MiniAppCommandFrame,
    active: boolean,
    reply?: (payload: MiniAppCommandReply) => void,
  ): void {
    if (appliedCommandIds.has(frame.commandId)) return
    if (appliedCommandIds.size >= MAX_APPLIED_IDS) appliedCommandIds.clear()
    appliedCommandIds.add(frame.commandId)
    const set = handlers.get(key(frame.miniApp, frame.channel))
    if (!set) return
    const event: MiniAppCommandEvent = {
      sessionId: frame.sessionId,
      active,
      payload: frame.payload,
      commandId: frame.commandId,
      seq: frame.seq,
      ...(reply ? { reply } : {}),
    }
    // Snapshot: a handler may (un)subscribe from inside itself; and one throwing
    // sink must never break the fan-out or the stream router above it.
    for (const handler of Array.from(set)) {
      try {
        handler(event)
      } catch {
        /* never let one sink crash the stream path */
      }
    }
  },

  /** Test seam: forget applied ids (registrations persist). */
  _clearApplied(): void {
    appliedCommandIds.clear()
  },
}
