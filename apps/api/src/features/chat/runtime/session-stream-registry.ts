import type { AgentStreamEvent } from '../contracts'

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

/**
 * Does a frame belong in the replay buffer a (re)connecting client rides?
 *
 * - `replayable` — the frame carries state a client that was away still needs. It is buffered,
 *   and it is NEVER dropped under backpressure.
 * - `live-only` — high-frequency or latest-wins: meaningless without the baseline it extends, or
 *   already superseded by the next frame. Kept OUT of the ring (so a hot stream never floods it,
 *   nor pays its O(n) overflow splice), and safe to drop under socket backpressure. A
 *   reconnecting client reconciles full session state from the DB anyway.
 */
type ReplayTier = 'replayable' | 'live-only'

/**
 * WHO on the multiplexed firehose receives a frame — orthogonal to {@link ReplayTier}, which
 * only says whether the frame is BUFFERED.
 *
 * - `watched` — only a connection that has DECLARED it is watching this publish key (see
 *   `subscribeScoped`). Everything a session VIEW renders belongs here: per-token deltas, the
 *   session panels, editor/terminal chatter. A client that is not looking at the session cannot
 *   render any of it, so shipping it there is pure cost — and the cost is not marginal. One
 *   session spawned 782 concurrent sub-agents and the browser received every frame of all of
 *   them; the tab (and the machine) froze.
 * - `roster` — EVERY connection, watched or not. Deliberately narrow: the frames a client must
 *   act on for a session it is NOT looking at. Three kinds qualify and nothing else does — the
 *   sidebar/roster rows, the notification producers (a background agent finishing is the whole
 *   point of long autonomy), and the round-trips a RUN BLOCKS ON (a HITL prompt or an awaited
 *   client command filtered away hangs the run until it times out).
 *
 * Getting this wrong is asymmetric, same as the replay tier: too-narrow strands a run or loses
 * a notification, too-broad rebuilds the firehose the scoping exists to kill.
 */
type DeliveryScope = 'watched' | 'roster'

/** `[replay tier, delivery scope]` — the two independent axes of one frame class. */
type EventTier = readonly [ReplayTier, DeliveryScope]

/**
 * EVERY `AgentStreamEvent` variant, and which tier it rides.
 *
 * Exhaustive BY CONSTRUCTION: this is a `Record` over the union, so adding a variant to
 * `contracts.ts` stops this file COMPILING until someone says whether it is replayable AND who
 * receives it. That is the point. The classification used to be a hand-written Set of the six
 * live-only types, and everything else was live-only-by-omission — a new high-frequency tick
 * (and they are exactly the kind of event people add) silently defaulted to REPLAYABLE, flooding
 * the ring and evicting other sessions' terminal `run.completed` frames. Nothing anywhere would
 * have caught it: the union has no other guard on the API side. The delivery scope rides the SAME
 * record for the same reason — a second hand-written list of "roster events" would drift from
 * this one on the first added variant, and the failure (an event silently unreachable for every
 * unwatched session) is invisible until a user reports a stuck run.
 *
 * Getting a REPLAY tier wrong is not symmetric, so choose deliberately:
 * - marking a stateful frame `live-only` loses it on reconnect (and lets backpressure drop it);
 * - marking a hot frame `replayable` floods the ring and replays a burst of stale state.
 */
const REPLAY_TIER: Record<AgentStreamEvent['type'], EventTier> = {
  // --- conversation state: the baseline a reconnecting client rebuilds from ---
  'message.created': ['replayable', 'watched'],
  'message.updated': ['replayable', 'watched'],
  // Incremental message appends have no meaning without the baseline they extend. A reconnecting
  // client reconciles from the DB and then rides the next full `message.updated` snapshot, so
  // replaying a bare delta would corrupt the assembled text.
  'message.delta': ['live-only', 'watched'],
  'message.removed': ['replayable', 'watched'],
  // The roster row itself: title, running flag, project. The sidebar shows every session, so
  // these two are the reason a `roster` scope exists at all.
  'session.updated': ['replayable', 'roster'],
  'session.deleted': ['replayable', 'roster'],
  'resources.changed': ['replayable', 'roster'],
  'child_session.updated': ['replayable', 'roster'],
  // A transient "doing now" label, superseded by the next activity/status frame. The single
  // hottest frame in the incident above: published per tool start, per tool end, and per streamed
  // output chunk, for every one of 782 sub-agents.
  'child_session.activity': ['live-only', 'watched'],

  // --- run lifecycle: terminal frames a client must not miss ---
  'run.started': ['replayable', 'roster'],
  // `run.completed` / `run.failed` are the notification producers for an unattended run — the
  // product's main long-autonomy signal (see packages/notifications policy.ts). Filtering them
  // for an unwatched session would mean a background agent finishes and the user never learns.
  'run.completed': ['replayable', 'roster'],
  'run.failed': ['replayable', 'roster'],
  // The HITL inbox is GLOBAL by design (see ui hitlInboxSlice.ts): a prompt is surfaced for any
  // session, not just the open one. A background run that asks for approval and whose request is
  // filtered away blocks forever with nothing on screen to unblock it.
  'hitl.requested': ['replayable', 'roster'],
  'hitl.resolved': ['replayable', 'roster'],
  // `roster`, for the same reason as the HITL pair above: a member asking the person a question
  // is surfaced wherever they are, and the room it was asked in is by definition one they were
  // not watching. Filtering it to the open session would leave the conversation waiting on
  // someone who was never told.
  'user.mentioned': ['replayable', 'roster'],
  'agent.phase': ['replayable', 'watched'],
  'session_timing.updated': ['replayable', 'watched'],
  'session_model_view.updated': ['replayable', 'watched'],
  'session_usage.updated': ['replayable', 'watched'],

  // --- editor / workspace ---
  'lsp.status': ['replayable', 'watched'],
  // Re-pushed when the editor (re)opens a file; a stale replayed frame for a file no longer open
  // is just noise.
  'lsp.diagnostics': ['live-only', 'watched'],
  // Delivered out-of-band straight to the UI data bus, where it is drop-to-latest anyway.
  // A plugin→UI command is an ordered state change the client must not miss — that is the
  // whole reason it is replayable. The client dedups replays by `commandId`.
  // `roster`, because `emitCommandWithReply` AWAITS the client's answer: a filtered command
  // leaves the tool call hanging on a promise only that client can settle.
  'plugin.command': ['replayable', 'roster'],
  'preview.updated': ['replayable', 'roster'],
  // Same blocking round-trip as `plugin.command`: `browser` waits for the host probe's
  // `preview-result` reply.
  'preview.command': ['live-only', 'roster'],
  'preview.closed': ['replayable', 'roster'],
  // A reconnecting client re-reads every directory its tree has loaded (ui `useLiveTreeRefresh`),
  // so a stale dir-change ping is meaningless.
  'fs.changed': ['live-only', 'watched'],
  // "Adopt + reveal this fresh agent PTY" is a one-shot UI action: a reload restores terminal
  // tabs from grid persistence, so replaying it would re-reveal a tab the user deliberately
  // closed.
  'terminal.opened': ['live-only', 'watched'],
  // Last-wins per terminal and superseded by the next frame; a reconnecting client re-reads the
  // live terminal registry (`useTerminalLiveness` refreshes on reconnect), so replaying stale
  // alt-screen/URL flips would only re-reveal tabs for a state that may already be gone.
  'terminal.state': ['live-only', 'watched'],
  // Volatile terminal activity is reconciled from the live terminal/background-job snapshot on
  // reconnect. Old waits/input gestures would fabricate stale transcript rows. A terminal exit is
  // different: the dead PTY is absent from the live snapshot, so the replayable terminalId-keyed
  // fact is the only way to settle a missed wait and retain its completion notification — and
  // that notification is why it is also `roster`.
  'terminal.waiting': ['live-only', 'watched'],
  'terminal.input': ['live-only', 'watched'],
  'terminal.finished': ['replayable', 'roster'],
  // --- session-scoped panels: each is a last-wins snapshot a reconnecting client needs ---
  'session_triggers.updated': ['replayable', 'watched'],
  'session_work.updated': ['replayable', 'watched'],
  // `roster`, unlike the work beside it: an open question is the person's to act on, so its
  // session's row has to say so while the person is looking at another one. It is rare by
  // nature — a question asked, a question closed — so the firehose pays nothing for it.
  'session_questions.updated': ['replayable', 'roster'],
  // A plan waiting for review is the person's to act on, like an open question — and as rare.
  'plan.updated': ['replayable', 'roster'],
  // Unfinished work moves with the plan beside it (approved, completed, set aside) — as rare, and
  // `roster` for the same reason: it is the ROOT's, read from a delegated child's composer too.
  'session_resume.updated': ['replayable', 'roster'],
  // "Open the plan tab now" is a one-shot UI cue, like `terminal.opened`: replaying it would
  // re-open a tab the person closed. `roster`, because the plan belongs to the ROOT session and
  // the person may be watching a delegated child's composer when it is presented.
  'plan.presented': ['live-only', 'roster'],
  // The user's whole "waiting on you" set — not session state, so published with an empty key
  // and delivered to every socket (`roster`), like `resources.changed`.
  'attention.updated': ['replayable', 'roster'],
  'hook.notice': ['replayable', 'watched'],
  'session_queue.updated': ['replayable', 'watched'],
  // Last-wins snapshot of one session's state; a reconnecting client needs the newest and
  // nothing older, and only while it is looking at that session.
  'session_permissions.updated': ['replayable', 'watched'],
}

const EVENT_TYPES = Object.keys(REPLAY_TIER) as AgentStreamEvent['type'][]

/** Derived, so it cannot drift from the classification above. */
const NON_REPLAYABLE_EVENTS = new Set<AgentStreamEvent['type']>(
  EVENT_TYPES.filter((type) => REPLAY_TIER[type][0] === 'live-only'),
)

/** Derived from the same table, for the same anti-drift reason. */
const WATCH_GATED_EVENTS = new Set<AgentStreamEvent['type']>(
  EVENT_TYPES.filter((type) => REPLAY_TIER[type][1] === 'watched'),
)

/**
 * A live-only event (see {@link REPLAY_TIER}): not kept in the replay buffer, and safe to DROP
 * under extreme socket backpressure — a `message.delta` is resynced by the next full
 * `message.updated` snapshot, and `child_session.activity` is a latest-wins tick.
 * Replayable frames must never be dropped.
 */
export function isLiveOnlyEvent(type: AgentStreamEvent['type']): boolean {
  return NON_REPLAYABLE_EVENTS.has(type)
}

/** The live-only set, for the guard that pins it. Reading it is the only way to see the tiers. */
export const LIVE_ONLY_EVENT_TYPES: ReadonlySet<AgentStreamEvent['type']> = NON_REPLAYABLE_EVENTS

/**
 * Does this frame require the receiving connection to have DECLARED it is watching the publish
 * key (see {@link DeliveryScope})? `false` = roster class, delivered to every connection.
 */
export function requiresWatchedSession(type: AgentStreamEvent['type']): boolean {
  return WATCH_GATED_EVENTS.has(type)
}

/** The roster set, for the guard that pins it — the complement of {@link requiresWatchedSession}. */
export const ROSTER_EVENT_TYPES: ReadonlySet<AgentStreamEvent['type']> = new Set(
  EVENT_TYPES.filter((type) => !WATCH_GATED_EVENTS.has(type)),
)

export interface ScopedSubscribeOptions {
  /** Resume cursor, as on `subscribeAll`. */
  since?: string | null
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
        if (globalEventLog.size <= MAX_TRACKED_USERS) break
      }
    }
  }

  // Drop a stale snapshot-shaped event from a replay ring before pushing the new
  // one: their UI handling is pure last-wins, so a long streaming turn would
  // otherwise park hundreds of near-identical multi-KB `message.updated` snapshots
  // (and replay them all as a burst on reconnect). `session_timing.updated` is
  // one-per-session. Returns the (possibly mutated) buffer for chaining.
  const compactSnapshot = (buffer: StreamEnvelope[], event: AgentStreamEvent) => {
    if (event.type === 'message.updated') {
      const messageId = event.message.id
      const stale = buffer.findIndex(
        (e) =>
          e.event.type === 'message.updated' &&
          e.event.sessionId === event.sessionId &&
          e.event.message.id === messageId,
      )
      if (stale !== -1) buffer.splice(stale, 1)
    } else if (event.type === 'session_timing.updated') {
      // Match per-session: the global ring interleaves users/sessions, so a bare
      // type match would wrongly drop another session's timing snapshot.
      const stale = buffer.findIndex(
        (e) => e.event.type === 'session_timing.updated' && e.event.sessionId === event.sessionId,
      )
      if (stale !== -1) buffer.splice(stale, 1)
    }
    return buffer
  }

  // Append an envelope to a ring buffer keyed by session/user: compact stale
  // snapshots first, push, trim to `maxSize`, re-insert at the tail (so the key
  // counts as most-recently-used for eviction), then run the ring's eviction.
  // Shared by the per-session and per-user (global firehose) rings.
  const pushToRing = (
    log: Map<string, StreamEnvelope[]>,
    key: string,
    event: AgentStreamEvent,
    envelope: StreamEnvelope,
    maxSize: number,
    evict: () => void,
  ) => {
    const buffered = compactSnapshot(log.get(key) ?? [], event)
    buffered.push(envelope)
    if (buffered.length > maxSize) {
      buffered.splice(0, buffered.length - maxSize)
    }
    log.delete(key)
    log.set(key, buffered)
    evict()
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
    // subscriber, a plugin re-publishing on a replayed frame) would otherwise mutate
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
  ) => {
    const entry: GlobalSubscriber = { deliver: subscriber, watching }
    const set = globalSubscribers.get(userId) ?? new Set<GlobalSubscriber>()
    set.add(entry)
    globalSubscribers.set(userId, set)

    const cursor = since ? Number(since) : null
    if (cursor !== null && Number.isFinite(cursor)) {
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
    // Takes EVERY frame. The browser wants {@link subscribeScoped} instead.
    subscribeAll(userId: string, subscriber: Subscriber, opts?: { since?: string | null }) {
      return subscribeGlobal(userId, subscriber, opts?.since, null)
    },

    /**
     * The firehose, SCOPED to the sessions the connection says it is rendering.
     *
     * Frames whose class is `watched` (see {@link DeliveryScope}) reach this subscriber only for a
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
      return subscribeGlobal(userId, subscriber, opts.since, opts.watching)
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
      const envelope: StreamEnvelope = {
        id: makeEventId(),
        sessionId,
        event,
        // Serialize exactly once — the SSE route used to JSON.stringify per
        // subscriber per event, which is O(payload × subscribers) on hot streams.
        data: JSON.stringify(event),
      }

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

      // Compact snapshot-shaped events (see compactSnapshot) in BOTH rings before
      // pushing — the global ring must dedup too, or one session's streaming turn
      // floods it and evicts other sessions' terminal (run.completed) events.
      pushToRing(sessionEventLog, sessionId, event, envelope, MAX_BUFFERED_EVENTS, evictIfNeeded)
      // Mirror into the per-user global ring so a (re)connecting firehose can
      // replay. The envelope (and its pre-serialized `data`) is shared BY
      // REFERENCE with the per-session ring — do not clone; the second ring only
      // costs array slots.
      pushToRing(
        globalEventLog,
        userId,
        event,
        envelope,
        MAX_GLOBAL_BUFFERED_EVENTS,
        evictGlobalIfNeeded,
      )

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
