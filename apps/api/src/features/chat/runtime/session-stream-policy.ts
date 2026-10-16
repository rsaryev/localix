import type { AgentStreamEvent } from '../contracts'

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
  // `roster`: a plan waiting for review is the person's to act on, so its session's row has to
  // say so while the person is looking at another one. It is rare, so the firehose pays little.
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
export const NON_REPLAYABLE_EVENTS = new Set<AgentStreamEvent['type']>(
  EVENT_TYPES.filter((type) => REPLAY_TIER[type][0] === 'live-only'),
)

/** Derived from the same table, for the same anti-drift reason. */
export const WATCH_GATED_EVENTS = new Set<AgentStreamEvent['type']>(
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
