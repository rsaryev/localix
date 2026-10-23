/**
 * A GENERIC live-stream contribution seam for the multiplexed realtime socket.
 *
 * A `BackendSubsystem` (e.g. a bundled workbench mini app) contributes a live stream —
 * a per-connection subscribe that spawns a stream and pushes tagged frames, torn down
 * on unsubscribe or socket close — WITHOUT `realtime/ws.ts` hardcoding each command
 * name / frame tag. ws.ts consults this registry for any command it does not otherwise
 * recognize, so a subsystem's live watch (its subscribe/unsubscribe command pair +
 * frame tag) lives entirely in the subsystem, not in core.
 */
import { RESERVED_FRAME_TAGS } from '../ws-frame-tags'

/**
 * One contributed live-stream: a subscribe command spawns a stream keyed per
 * (connection, params) and sends `<frameTag>\n<json>` frames; an unsubscribe command
 * (or socket close) tears it down.
 */
/**
 * What the HOST knows about the socket a stream starts on — never what the client sent.
 *
 * A stream of someone's own data (one chat's board, one user's inbox) has to know whose socket
 * asked. Taking the user from the params would let any socket name any user; with no identity at
 * all, a mini app could stream only data that belongs to nobody. The host binds it from the
 * authenticated socket, so a contribution checks ownership against the one identity it can trust.
 */
export interface WsFrameStreamContext {
  readonly userId: string
}

export interface WsFrameContribution<Params = Record<string, unknown>, Handle = unknown> {
  /** The realtime-command `t` that STARTS a stream (e.g. `'logs.subscribe'`). */
  subscribeCommand: string
  /** The realtime-command `t` that TEARS a stream down. */
  unsubscribeCommand: string
  /**
   * Frame tag prefixed to every streamed frame — the registry builds `<frameTag>\n<data>`
   * (matching core's session `s\n…` frames). Pick a distinct
   * single char the client demuxer can switch on — never one of `RESERVED_FRAME_TAGS`.
   */
  frameTag: string
  /**
   * Stable per-connection key derived from a command's params so subscribers of the
   * same stream share (refcount) ONE spawn and an unsubscribe finds the right handle.
   * Defaults to `JSON.stringify(params)`.
   */
  key?: (params: Params) => string
  /**
   * Start the stream. `send(data)` pushes ONE frame — the registry applies the
   * `<frameTag>\n` framing, so pass just the payload (typically `JSON.stringify(frame)`).
   * Return an opaque handle used to tear the stream down. `context` is the socket's identity,
   * bound by the host (see {@link WsFrameStreamContext}).
   */
  start(params: Params, send: (data: string) => void, context: WsFrameStreamContext): Handle
  /** Tear down a handle returned by `start`. */
  stop(handle: Handle): void
}

/**
 * Outcome of {@link WsFrameRegistry.register}. Command routing is by exact `t` match and
 * checks subscribe before unsubscribe, so a command reused in either direction is
 * UNRESOLVABLE — one branch silently wins and the other never starts / tears down. Rejecting
 * every cross-direction collision at registration turns register-order ambiguity into a
 * loud diagnostic. Registration is UNTRUSTED mini app data, so this returns a result instead
 * of throwing: the composition root logs the rejection, keeping one colliding mini app from
 * crashing boot for every other subsystem.
 */
export type WsFrameRegistration =
  | { status: 'registered' }
  | { status: 'rejected'; reason: 'duplicate_subscribe' | 'duplicate_unsubscribe'; command: string }
  | { status: 'rejected'; reason: 'reserved_tag'; command: string; tag: string }

/** The tags core sends itself; see `ws-frame-tags.ts`. */
export { RESERVED_FRAME_TAGS }

export interface WsFrameRegistry {
  /**
   * Register a contribution. Rejects (does NOT add) a contribution if either command is
   * already used in either direction, or if both directions use the same command. Such a
   * collision is unroutable because subscribe is checked first. Returns a diagnostic;
   * never throws.
   */
  register(contribution: WsFrameContribution): WsFrameRegistration
  /**
   * Remove a contribution — hot mini app disable. Pass the CONTRIBUTION you registered, not a
   * bare command: `register` rejects a duplicate `subscribeCommand` and keeps the first, but
   * the loser's record still carries that command, so removing by name evicted the WINNER's
   * live stream — a mini app that is still enabled, with its subsystem and UI tab intact,
   * silently refusing new subscribes. (Same rule as the resource-ref and search registries.)
   * Blocks NEW subscribes only: a live stream keeps its contribution reference inside its
   * `WsFrameConnection`, so teardown remains the mini app's `onShutdown` / socket close.
   * Unknown or foreign entries are a no-op.
   */
  unregister(contribution: WsFrameContribution | string): void
  /** Registered contributions in insertion order. */
  list(): WsFrameContribution[]
  /** The contribution whose `subscribeCommand` equals `t`, if any. */
  findBySubscribe(t: string): WsFrameContribution | undefined
  /** The contribution whose `unsubscribeCommand` equals `t`, if any. */
  findByUnsubscribe(t: string): WsFrameContribution | undefined
}

/** Simple array-backed registry; `list()` preserves insertion order. */
export function createWsFrameRegistry(): WsFrameRegistry {
  const contributions: WsFrameContribution[] = []
  return {
    register(c) {
      if (RESERVED_FRAME_TAGS.has(c.frameTag)) {
        return {
          status: 'rejected',
          reason: 'reserved_tag',
          command: c.subscribeCommand,
          tag: c.frameTag,
        }
      }
      // Reject BY CONSTRUCTION so a command can never shadow one in the other direction:
      // websocket dispatch checks subscribe before unsubscribe, making the latter branch
      // unreachable even when the colliding commands belong to different contributions.
      if (
        contributions.some(
          (existing) =>
            existing.subscribeCommand === c.subscribeCommand ||
            existing.unsubscribeCommand === c.subscribeCommand,
        )
      )
        return { status: 'rejected', reason: 'duplicate_subscribe', command: c.subscribeCommand }
      if (
        c.subscribeCommand === c.unsubscribeCommand ||
        contributions.some(
          (existing) =>
            existing.subscribeCommand === c.unsubscribeCommand ||
            existing.unsubscribeCommand === c.unsubscribeCommand,
        )
      )
        return {
          status: 'rejected',
          reason: 'duplicate_unsubscribe',
          command: c.unsubscribeCommand,
        }
      contributions.push(c)
      return { status: 'registered' }
    },
    unregister(contribution) {
      const command =
        typeof contribution === 'string' ? contribution : contribution.subscribeCommand
      const idx = contributions.findIndex((c) => c.subscribeCommand === command)
      if (idx < 0) return
      // Identity-checked: a mini app's disable must not evict a contribution it never owned.
      if (typeof contribution !== 'string' && contributions[idx] !== contribution) return
      contributions.splice(idx, 1)
    },
    list() {
      return contributions.slice()
    },
    findBySubscribe(t) {
      return contributions.find((c) => c.subscribeCommand === t)
    },
    findByUnsubscribe(t) {
      return contributions.find((c) => c.unsubscribeCommand === t)
    },
  }
}

/**
 * Per-connection stream state for one realtime socket. ws.ts creates one of these
 * per connection (with `send` bound to that socket) and routes any unrecognized
 * command through it; `teardown()` runs on socket close. Pure enough to unit-test
 * in isolation (inject a fake `send` + a registry of fake contributions).
 */
export interface WsFrameConnection {
  /** Handle a subscribe command. Returns true if a contribution owned `t` (started/idempotent). */
  subscribe(t: string, params: Record<string, unknown>): boolean
  /** Handle an unsubscribe command. Returns true if a contribution owned `t`. */
  unsubscribe(t: string, params: Record<string, unknown>): boolean
  /** Stop every stream this connection started (socket close). */
  teardown(): void
}

export interface WsFrameConnectionOptions {
  /** Maximum distinct live stream handles owned by one socket. Default 64. */
  maxActiveStreams?: number
}

export const WS_FRAME_DEFAULT_MAX_ACTIVE_STREAMS = 64
export const WS_FRAME_MAX_KEY_CHARS = 4096

export function createWsFrameConnection(
  registry: WsFrameRegistry,
  send: (frame: string) => void,
  context: WsFrameStreamContext,
  options: WsFrameConnectionOptions = {},
): WsFrameConnection {
  const maxActiveStreams = options.maxActiveStreams ?? WS_FRAME_DEFAULT_MAX_ACTIVE_STREAMS
  if (!Number.isSafeInteger(maxActiveStreams) || maxActiveStreams < 1) {
    throw new RangeError('maxActiveStreams must be a positive safe integer')
  }
  // Active streams keyed by `<subscribeCommand>\n<params-key>`, REFCOUNTED per key:
  // several client-side subscribers (e.g. the k8s sidebar AND a pod tab watching the
  // same namespace) share one socket, each sending its own subscribe/unsubscribe.
  // Start only on 0→1, stop only when the last subscriber leaves — otherwise
  // whichever subscriber unmounts first would kill the stream for the rest.
  const active = new Map<
    string,
    { contribution: WsFrameContribution; handle: unknown; count: number }
  >()

  const streamKey = (c: WsFrameContribution, params: Record<string, unknown>): string => {
    const k = c.key ? c.key(params) : JSON.stringify(params)
    if (typeof k !== 'string' || k.length > WS_FRAME_MAX_KEY_CHARS) {
      throw new Error('invalid websocket stream key')
    }
    return `${c.subscribeCommand}\n${k}`
  }

  return {
    subscribe(t, params) {
      const c = registry.findBySubscribe(t)
      if (!c) return false
      let key: string
      try {
        key = streamKey(c, params)
      } catch {
        return false
      }
      const entry = active.get(key)
      if (entry?.contribution === c) {
        entry.count++
        return true
      }
      // Hot reload replaces the owner under the same command. Its stopped handle must not
      // absorb the new subscribe, and the old owner's refcounts do not belong to this one.
      if (entry) {
        active.delete(key)
        try {
          entry.contribution.stop(entry.handle)
        } catch {
          /* a stale owner's teardown must not block its replacement */
        }
      }
      if (active.size >= maxActiveStreams) return false
      let handle: unknown
      try {
        handle = c.start(
          params,
          (data) => {
            try {
              send(`${c.frameTag}\n${data}`)
            } catch {
              /* socket closing — teardown() releases the stream */
            }
          },
          context,
        )
      } catch {
        return false
      }
      active.set(key, { contribution: c, handle, count: 1 })
      return true
    },
    unsubscribe(t, params) {
      const c = registry.findByUnsubscribe(t)
      if (!c) return false
      let key: string
      try {
        key = streamKey(c, params)
      } catch {
        return false
      }
      const entry = active.get(key)
      // No-op when absent (an unbalanced unsubscribe must not go negative).
      if (entry && --entry.count <= 0) {
        active.delete(key)
        try {
          entry.contribution.stop(entry.handle)
        } catch {
          /* mini app teardown failure must not escape the socket lifecycle */
        }
      }
      return true
    },
    teardown() {
      const entries = [...active.values()]
      active.clear()
      for (const { contribution, handle } of entries) {
        try {
          contribution.stop(handle)
        } catch {
          /* continue releasing every other mini app stream */
        }
      }
    },
  }
}
