import type { AgentStreamEvent } from '../contracts'
import { pushToRing } from './session-stream-replay-ring'
import { NON_REPLAYABLE_EVENTS, WATCH_GATED_EVENTS } from './session-stream-policy'

export { isLiveOnlyEvent } from './session-stream-policy'

type Subscriber = (event: StreamEnvelope) => void

/**
 * One firehose connection. `watching` is the set of publish keys that connection declared it is
 * ACTIVELY rendering (see {@link SessionStreamRegistry.subscribeScoped}); `null` means an
 * UNSCOPED firehose that takes every frame.
 */
interface GlobalSubscriber {
  deliver: Subscriber
  watching: ReadonlySet<string> | null
}

type UserSubscriberMap = Map<string, Set<GlobalSubscriber>>

export interface StreamEnvelope {
  id: string
  /** The publish key (registry session id) — the routing key a multiplexed subscriber demuxes on. */
  sessionId: string
  event: AgentStreamEvent
  /** Event serialized once at publish time — subscribers and replay reuse it instead of re-stringifying per consumer. */
  data: string
}

const MAX_BUFFERED_EVENTS = 500
// Replay-buffer size for the multiplexed firehose (all sessions on one socket).
// Larger than the per-session ring because it interleaves every session's events.
const MAX_GLOBAL_BUFFERED_EVENTS = 2000
// Cap how many distinct sessions retain a replay buffer. Without this the
// per-session event log accumulates forever (a slow memory leak on a
// long-lived server). When exceeded we evict the least-recently-published
// session that has no active subscribers.
const MAX_TRACKED_SESSIONS = 256
// Cap how many distinct users retain a global replay ring. Bounds memory in a
// multi-tenant deployment; single-user installs never approach it. Users with a
// live firehose connection are never evicted (see evictGlobalIfNeeded).
const MAX_TRACKED_USERS = 256

export interface ScopedSubscribeOptions {
  /** Resume cursor, as on `subscribeAll`. */
  since?: string | null
  /** Called before the replay when frames after `since` are gone (see `subscribeAll`). */
  onGap?: (droppedThrough: string) => void
  /**
   * The publish keys this connection is ACTIVELY rendering — a LIVE set the CALLER owns and
   * MUTATES in place (the transport adds/removes ids as the client sends watch/unwatch commands).
   *
   * Deliberately not a copied value and deliberately not a re-subscribe. The watched set changes
   * throughout a socket's life, and tearing the subscription down to re-create it with the new set
   * would REPLAY from the cursor — re-delivering every roster frame in the ring, which is exactly
   * what the exactly-once contract cannot survive. Handing over the live set keeps the per-frame
   * filter on the current truth while the subscription, and therefore the cursor, never moves.
   *
   * An EMPTY set is meaningful (roster-only), which is why this is required rather than optional:
   * "I forgot to pass it" must not silently mean "send me everything".
   */
  watching: ReadonlySet<string>
}

/**
 * Fan ONE envelope to ONE subscriber with the failure ISOLATED. A subscriber is a
 * detached delivery target (a `ws.send`, an in-process mirror) — one target throwing
 * (a socket mid-close is the common case) must neither starve the OTHER subscribers of
 * this frame nor propagate back into the PUBLISHER. The publisher's callers are agent-run
 * hot paths that would otherwise leak run state on the way out: `executeRun` publishes
 * `run.started` (and the "Connecting" phase) BETWEEN `activeRuns.set` and the run's
 * try/finally, so a subscriber throw there escaped both guards and wedged the session
 * `running` forever (isRunning stays true, every future run throws "already running",
 * stop() can't recover). Isolating the fan-out closes that tear BY CONSTRUCTION for every
 * publish site at once. Swallowed silently — matching each subscriber's own close-socket
 * `catch {}` — so this hottest-in-the-system path never emits per-frame log spam.
 */
/**
 * The wire text is encoded on first read. Most streaming deltas reach no subscriber (a session
 * nobody watches), and a buffered snapshot is often compacted away before any reconnect replays
 * it — neither should pay for the encode.
 */
function createEnvelope(id: string, sessionId: string, event: AgentStreamEvent): StreamEnvelope {
  let data: string | undefined
  return {
    id,
    sessionId,
    event,
    get data() {
      data ??= JSON.stringify(event)
      return data
    },
  }
}

function deliver(subscriber: Subscriber, envelope: StreamEnvelope): void {
  try {
    subscriber(envelope)
  } catch {
    /* a failing target (closing socket) must never crash the fan-out or the publisher */
  }
}

export function createSessionStreamRegistry() {
  const subscribers = new Map<string, Set<Subscriber>>()
  // Multiplexed firehose: every connection here receives ALL sessions' events on
  // one socket. This is what the UI uses so it never exhausts the browser's
  // 6-connections-per-origin HTTP/1.1 cap (each per-session EventSource used to
  // burn one slot, so ~6 live sessions starved every other request).
  const globalSubscribers: UserSubscriberMap = new Map()
  const globalEventLog = new Map<string, StreamEnvelope[]>()
  // Map insertion order doubles as an LRU recency list: re-publishing a session
  // re-inserts it at the tail (see publish).
  const sessionEventLog = new Map<string, StreamEnvelope[]>()
  // Per user, the newest id its global ring no longer holds (trimmed, or the whole ring evicted).
  const droppedThrough = new Map<string, number>()
  let nextEventId = 0

  const makeEventId = () => String(++nextEventId)

  const evictIfNeeded = () => {
    if (sessionEventLog.size <= MAX_TRACKED_SESSIONS) return
    for (const sessionId of sessionEventLog.keys()) {
      // Never evict a session a client is actively replaying/subscribed to.
      if (!subscribers.has(sessionId)) {
        sessionEventLog.delete(sessionId)
        if (sessionEventLog.size <= MAX_TRACKED_SESSIONS) break
      }
    }
  }

  const evictGlobalIfNeeded = () => {
    if (globalEventLog.size <= MAX_TRACKED_USERS) return
    for (const userId of globalEventLog.keys()) {
      // Never evict a user with a live firehose connection (their replay matters).
      if (!globalSubscribers.has(userId)) {
        globalEventLog.delete(userId)
        droppedThrough.set(userId, nextEventId)
        if (globalEventLog.size <= MAX_TRACKED_USERS) break
      }
    }
  }

  // Is `envelope` in scope for this connection? An unscoped firehose takes everything; a scoped
  // one takes the roster class plus anything published under a key it declared. Read on EVERY
  // frame (never snapshotted) so a watch/unwatch takes effect immediately — see the note on
  // `ScopedSubscribeOptions.watching` for why the alternative (re-subscribing) is unsafe.
  const inScope = (entry: GlobalSubscriber, envelope: StreamEnvelope): boolean =>
    !entry.watching ||
    !WATCH_GATED_EVENTS.has(envelope.event.type) ||
    entry.watching.has(envelope.sessionId)

  const replayGlobal = (userId: string, entry: GlobalSubscriber, since: number) => {
    // Iterate a SNAPSHOT, not the live ring: a subscriber that re-enters publish()
    // during replay (any callback that does more than ws.send — a future in-process
    // subscriber, a mini app re-publishing on a replayed frame) would otherwise mutate
    // the array mid-`for…of`; the new envelope (id > since) gets BOTH fanned live and
    // re-visited by this loop → the same frame delivered twice. The copy freezes the
    // replay set at subscribe time so it stays disjoint from the live fan. See the
    // exactly-once contract note on `subscribeAll`.
    const buffered = (globalEventLog.get(userId) ?? []).slice()
    for (const envelope of buffered) {
      if (Number(envelope.id) > since && inScope(entry, envelope)) {
        deliver(entry.deliver, envelope)
      }
    }
  }

  const fanGlobal = (userId: string, envelope: StreamEnvelope) => {
    const subscribersForUser = globalSubscribers.get(userId)
    if (!subscribersForUser) return
    for (const entry of subscribersForUser) {
      if (inScope(entry, envelope)) deliver(entry.deliver, envelope)
    }
  }

  // The one implementation behind `subscribeAll` (watching === null) and `subscribeScoped`.
  // Registering the live entry and replaying MUST stay in one synchronous body with no `await`
  // between them — that is what makes the two delivery sets disjoint. See the exactly-once
  // contract note on `subscribeAll`.
  const subscribeGlobal = (
    userId: string,
    subscriber: Subscriber,
    since: string | null | undefined,
    watching: ReadonlySet<string> | null,
    onGap?: (droppedThrough: string) => void,
  ) => {
    const entry: GlobalSubscriber = { deliver: subscriber, watching }
    const set = globalSubscribers.get(userId) ?? new Set<GlobalSubscriber>()
    set.add(entry)
    globalSubscribers.set(userId, set)

    const cursor = since ? Number(since) : null
    if (cursor !== null && Number.isFinite(cursor)) {
      const dropped = droppedThrough.get(userId) ?? 0
      if (cursor < dropped) onGap?.(String(dropped))
      replayGlobal(userId, entry, cursor)
    }

    return () => {
      const current = globalSubscribers.get(userId)
      if (!current) return
      current.delete(entry)
      if (current.size === 0) {
        globalSubscribers.delete(userId)
      }
    }
  }

  return {
    subscribe(sessionId: string, subscriber: Subscriber, opts?: { since?: string | null }) {
      const set = subscribers.get(sessionId) ?? new Set<Subscriber>()
      set.add(subscriber)
      subscribers.set(sessionId, set)

      const since = opts?.since ? Number(opts.since) : null
      if (since !== null && Number.isFinite(since)) {
        // Snapshot the ring before replay (see replayGlobal): a re-entrant publish
        // from within `subscriber` must not be re-visited by this loop AND fanned
        // live — that double-delivers the frame.
        const buffered = (sessionEventLog.get(sessionId) ?? []).slice()
        // NOTE (gap-detection, low-priority): if `since` is older than the first
        // buffered id, the client missed >MAX_BUFFERED_EVENTS events and we replay
        // only a suffix. This is tolerated because the UI runs reconcileSession()
        // on (re)connect, which re-fetches full session state. If that fallback is
        // ever removed, emit an explicit "resync required" hint here instead.
        for (const envelope of buffered) {
          if (Number(envelope.id) > since) {
            deliver(subscriber, envelope)
          }
        }
      }

      return () => {
        const current = subscribers.get(sessionId)
        if (!current) return
        current.delete(subscriber)
        if (current.size === 0) {
          subscribers.delete(sessionId)
        }
      }
    },

    // Subscribe to the multiplexed firehose (every session's events on one
    // connection). `since` replays from the global ring buffer; ids are process-wide
    // and monotonic within one API boot, so one cursor catches all sessions at once.
    //
    // EXACTLY-ONCE-PER-CURSOR CONTRACT (client reducers depend on this): for a given
    // (subscriber, since), every replayable frame is delivered AT MOST ONCE. Replay
    // covers ids in (since, maxBufferedAtSubscribe]; the live fan covers ids >
    // maxBufferedAtSubscribe (every publish mints a strictly larger id) — the two
    // sets are disjoint by construction. This holds because subscribe registers the
    // live subscriber and replays SYNCHRONOUSLY, with no `await` between: no publish
    // can interleave to land a frame in both sets. Do not introduce an await here,
    // and keep replay iterating a ring SNAPSHOT (replayGlobal) so a re-entrant
    // publish can't be double-counted. Non-idempotent client reducers
    // (hook.notice append, counters) MAY rely on this.
    //
    // A cursor older than what the ring still holds (trimmed, or the user's ring evicted) replays
    // only a suffix; a scoped subscriber hears of it first through `onGap`.
    //
    // Takes EVERY frame. The browser wants {@link subscribeScoped} instead.
    subscribeAll(userId: string, subscriber: Subscriber, opts?: { since?: string | null }) {
      return subscribeGlobal(userId, subscriber, opts?.since, null)
    },

    /**
     * The firehose, SCOPED to the sessions the connection says it is rendering.
     *
     * Frames whose class is `watched` (see session-stream-policy.ts) reach this subscriber only for a
     * publish key in `opts.watching`; the `roster` class always reaches it. Everything else about
     * the subscription — replay, cursor, ordering, the exactly-once guarantee documented on
     * `subscribeAll` — is IDENTICAL, because the scope decision is a per-frame predicate applied
     * inside the same replay/fan code, not a second delivery path.
     *
     * One consequence worth stating: the filter is applied on REPLAY too, so a client's cursor
     * advances past frames it was never sent. That is correct — the cursor means "the last frame
     * I received" — and it means adding a session to the watched set does NOT retroactively
     * deliver its buffered frames. It must not: the roster frames in that range were already
     * delivered, so a catch-up replay would double-deliver them and break the contract above.
     * Watching a session is a client gesture that comes WITH a full reconcile from the DB
     * (ui reconcileSession), which is the correct way to close that gap.
     */
    subscribeScoped(userId: string, subscriber: Subscriber, opts: ScopedSubscribeOptions) {
      return subscribeGlobal(userId, subscriber, opts.since, opts.watching, opts.onGap)
    },

    /**
     * Is ANYONE positioned to render `sessionId` right now — a per-session subscriber, or a
     * firehose connection watching that key (or an unscoped one)?
     *
     * The early-out for transient publishers (`child_session.activity`). It used to be two coarse
     * questions — "does this session have a subscriber" OR "is this user connected at all" — and
     * the second one is true whenever a browser tab is open, so 782 unattended sub-agents each
     * serialized and fanned an activity frame that every scoped connection then discarded. Asking
     * the precise question makes the early-out actually early.
     */
    hasWatchers(userId: string, sessionId: string): boolean {
      if ((subscribers.get(sessionId)?.size ?? 0) > 0) return true
      const globals = globalSubscribers.get(userId)
      if (!globals) return false
      for (const entry of globals) {
        if (!entry.watching || entry.watching.has(sessionId)) return true
      }
      return false
    },
    hasConnectedClient(userId: string): boolean {
      return (globalSubscribers.get(userId)?.size ?? 0) > 0
    },

    publish(userId: string, sessionId: string, event: AgentStreamEvent) {
      // Serialized at most once and shared by every subscriber — the SSE route used to
      // JSON.stringify per subscriber per event, O(payload × subscribers) on hot streams.
      const envelope = createEnvelope(makeEventId(), sessionId, event)

      // Live-only events skip the replay buffer entirely (see NON_REPLAYABLE_EVENTS):
      // fan out to current subscribers and return, so a high-frequency stream never
      // touches the per-session ring or its overflow splice.
      if (NON_REPLAYABLE_EVENTS.has(event.type)) {
        const liveSet = subscribers.get(sessionId)
        if (liveSet) {
          for (const subscriber of liveSet) {
            deliver(subscriber, envelope)
          }
        }
        fanGlobal(userId, envelope)
        return
      }

      // Compact snapshot-shaped events (see session-stream-replay-ring.ts) in BOTH rings before
      // pushing — the global ring must dedup too, or one session's streaming turn
      // floods it and evicts other sessions' terminal (run.completed) events.
      pushToRing(sessionEventLog, sessionId, event, envelope, MAX_BUFFERED_EVENTS, evictIfNeeded)
      // Mirror into the per-user global ring so a (re)connecting firehose can
      // replay. The envelope (and its pre-serialized `data`) is shared BY
      // REFERENCE with the per-session ring — do not clone; the second ring only
      // costs array slots.
      const trimmed = pushToRing(
        globalEventLog,
        userId,
        event,
        envelope,
        MAX_GLOBAL_BUFFERED_EVENTS,
        evictGlobalIfNeeded,
      )
      if (trimmed !== null) droppedThrough.set(userId, Number(trimmed))

      const set = subscribers.get(sessionId)
      if (set) {
        for (const subscriber of set) {
          deliver(subscriber, envelope)
        }
      }
      fanGlobal(userId, envelope)
    },
  }
}

export type SessionStreamRegistry = ReturnType<typeof createSessionStreamRegistry>

/**
 * Publish a simple `agent.phase` activity marker (the "Connecting → Loading
 * context → Compressing → Titling" reel the UI single-line status reads). The
 * payload is `{ phase, active }` plus a `label` only for phases whose copy is data
 * (see the contract). Lives in this runtime leaf so both runtime/ and service/
 * callers can share it without a layering inversion. Cheap fire-and-forget —
 * adds no latency.
 */
export function publishAgentPhase(
  streamRegistry: SessionStreamRegistry,
  userId: string,
  sessionId: string,
  phase: string,
  active: boolean,
  label?: string,
): void {
  streamRegistry.publish(userId, sessionId, {
    type: 'agent.phase',
    sessionId,
    phase,
    ...(label === undefined ? {} : { label }),
    active,
  })
}
