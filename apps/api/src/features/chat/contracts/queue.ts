import type { ParticipantRef } from '../../../db/participant'
import type { MessageBinding } from './messages'

/**
 * Public shape of one piece of RUNNING background work (`features/work`) — a job, a stream, a
 * promoted call, a monitor, a detached sub-agent — what the composer lists. Only running work is
 * listed, so it carries no status; how a piece ended is on its transcript item (for a sub-agent,
 * in the report its parent receives).
 */
export interface SessionWork {
  /** `bg-3`, `mon-1`, `sub-2` — the same id the agent uses. */
  id: string
  kind: 'job' | 'monitor' | 'stream' | 'promoted' | 'subagent'
  /** What it is; a monitor's names the Vault keys its command uses, which must be visible. */
  label: string
  startedAt: string
  /** The action-registry key: Stop goes through `/tools/interact` when there is no terminal. */
  toolCallId: string
  /** The PTY it runs in, when it has one — the row opens it, and Stop closes it. */
  terminalId: string | null
  /** A monitor's events so far, and the latest — the answer to "what is it seeing?". */
  eventCount: number
  lastEvent: string | null
  lastEventAt: string | null
}

/**
 * Public shape of one active session loop — userId omitted (it's the session owner's).
 * Ephemeral runtime state: process-local, not persisted to the DB.
 */
export interface SessionLoopSummary {
  id: string
  /** 'fixed' = recurring cron cadence; 'dynamic' = self-pacing (agent picks the next delay). */
  kind: 'fixed' | 'dynamic'
  /** 5-field cron for fixed loops; `null` for dynamic loops. */
  cron: string | null
  prompt: string
  /** True when this loop runs the maintenance routine (no explicit task). */
  maintenance: boolean
  /** Dynamic loops: the last delay (seconds) the agent chose. */
  delaySeconds?: number
  /** Next fire. Always set: a dynamic loop re-arms at its last delay instead of going idle. */
  nextRunAt: string
  createdAt: string
  /** 'session' = fires inject into this session; 'subsession' = each fire runs in a fresh child session. */
  target: 'session' | 'subsession'
  /** Most recent fire (null before the first). */
  lastRunAt: string | null
  /** Outcome of the most recent fire (null before the first). */
  lastStatus: 'ok' | 'error' | null
  /** Total fires so far. */
  runCount: number
  /**
   * ISO timestamp until which this loop's occurrence is being HELD because the provider route
   * of the participant it is addressed to is exhausted (a prior run on that route failed
   * rate-limited, so `finalize` set a route cooldown the loop gate consults before firing).
   * `null` when nothing is holding it.
   *
   * Read off the trigger's persisted `rate-limited` hold (`loops/record.ts`), so it names the
   * same route the gate decided on and survives a restart together with the hold.
   *
   * It exists because the hold was otherwise INVISIBLE: `lastStatus` reports whether the
   * WAKE was delivered ("ok" = enqueued), so after the quota ran out the loop kept reading
   * `ok` while quietly doing nothing for up to an hour, with `nextRunAt` still advancing.
   * Session-target loops only; a subsession fire does not touch the parent's quota gate.
   */
  heldUntil?: string | null
}

/**
 * Provenance of a non-user-typed turn — the typed dictionary of KNOWN wake
 * producers. This is the ONE place that enumerates sources; the storage payload
 * keeps it as an opaque string (`StoredMessagePayload.origin`) and the runtime
 * primitive accepts it as `source`. Orthogonal to `isInternal` (UI visibility):
 * `WakeSource` answers "where did this turn come from", not "is it hidden".
 *   - loop / bg-job / bg-monitor → the scheduled and background wake producers
 *   - user-busy → a user message queued while the session was busy (priority 0)
 */
export type WakeSource =
  | 'loop'
  | 'bg-job'
  | 'bg-monitor'
  | 'user-busy'
  /** A user message STEERED into the run in flight: injected at the next turn
   * boundary (the model saw it mid-run), persisted when injected. Its transcript
   * row sits after the run's assistant row, so the next run's model view carries a
   * causality note (see runtime/history/stages/media.ts). */
  | 'user-steer'
  /** A background CC `asyncRewake` hook exited 2 and woke the session. */
  | 'hook'
  /** An inbound webhook: a message pushed into the session by an EXTERNAL system
   * (another agent, CI, a monitor) via `POST /rpc/webhook/...`, not our frontend. */
  | 'external'
  /**
   * A PLUGIN ASKED FOR A TURN: something happened in it — a person moved in its view, a
   * condition it watches came true — and the agent answers through the plugin's own tools
   * (`features/plugins/plugin-wake.ts`). Its own source because "External" named a webhook,
   * and a person playing a game in a plugin tab is not one.
   */
  | 'plugin'
  /** A background (non-blocking) delegate child finished — its final result is
   * pushed back into the parent session as this wake. */
  | 'subagent'
  /**
   * SOMEONE MARKED A MESSAGE. A reaction is a message about a message, and a mark the person
   * places is addressed to whoever wrote the row — so it asks for a turn the way a typed line
   * does, at wake priority, and the recipient answers or stays quiet as it judges.
   *
   * Its own source because the chip in the composer has to say what woke the session, and
   * every other value here would name the wrong thing: this came from the person, in this
   * conversation, about something already said.
   */
  | 'reaction'
  /**
   * THE AGENT THAT DELEGATED A TASK SPOKE TO ITS CHILD — `fork` action message.
   *
   * The reverse of `subagent`: that one carries a child's report up, this carries its delegator's
   * word down. A running child takes it at its next step boundary (`isDelegatorMessage`); an idle
   * one runs for it, and that run reports back like the first.
   */
  | 'delegator'
  /**
   * THE PERSON DECIDED ON A PLAN THE AGENT PRESENTED (`features/plans`): `plan-review` sends the
   * version's comments back for a revision, `plan-approved` hands it over for implementation in
   * the mode the person chose. Their own sources because the chip has to say which decision
   * opened the turn — a review asks for a new version, an approval for the work itself.
   */
  | 'plan-review'
  | 'plan-approved'
  /**
   * THE PERSON ASKED THE AGENT TO CONTINUE UNFINISHED WORK (`features/resume`): an approved plan
   * whose run stopped, and later any other producer's point. One source for every kind, because
   * the chip says what opened the turn — the person's Continue — and the turn's text says what.
   */
  | 'resume'

/**
 * ONE WAKE, AS ONE VALUE — the only way a turn starts without someone typing.
 *
 * It was seven positional arguments after the user, five of them optional: producers passed an
 * `undefined` placeholder to reach `source`, forwarders re-spread `...args` and logged `args[1]`
 * as the session id, and `source` was optional although a wake without one renders with no
 * provenance chip. As a request the source is REQUIRED — every wake has a producer — and each
 * optional field is named where it is set.
 */
export interface WakeRequest {
  userId: string
  sessionId: string
  /** The internal message the woken turn reads. */
  content: string
  /** Who woke it; drives the "via …" chip and the self-caused chain budget. */
  source: WakeSource
  /** Which participant the turn concerns; absent lets the conversation strategy choose. */
  to?: { participant: ParticipantRef; handle?: string }
  /**
   * THE PERSON'S WORDS THIS WAKE CARRIES — route it as the conversation routes a typed message
   * with this text. Without it an unaddressed wake goes to one participant by the runtime rule
   * (least recently dispatched), which is right for a machine report and wrong for something the
   * person said: an approval handed to "@backend" reached whoever was least
   * recent, and `@all` reached one agent. With it the strategy reads the text exactly as it reads
   * a message — its `@handle` mentions, `@all`, and its default answerer when none is named
   * (empty text = no mention). Mutually exclusive with `to`, which wins when both are set.
   */
  addressedAs?: string
  /** Idempotency key: a second wake with the same key is the same delivery. */
  deliveryKey?: string
  /**
   * Admit this delivery ONCE EVER, not once per queue row: the store records a durable receipt
   * for `deliveryKey` in the same transaction as the row, and the receipt outlives the row's
   * acknowledgement. For a delivery two paths race to make — a child's report, sent live and
   * again by the recovery sweep — so whichever loses is a duplicate even after a restart.
   * Requires `deliveryKey`.
   */
  receipt?: true
  /** Tools the woken turn may not call (a fixed loop may not reschedule itself). */
  extraDisabledTools?: string[]
  /**
   * The plugin whose tools the woken turn answers with. They ride the wake's row onto the wire
   * for the turn that answers it (`runtime/run/surface-tools.ts`) — a turn woken to call a
   * plugin's tool used to find it deferred and spend its first call fetching the schema. They
   * are NOT kept on the session: a board that woke the chat once used to leave its tool on every
   * later request, long after the board was closed.
   */
  plugin?: string
}

/**
 * Public shape of one message queued behind an in-flight run. Ephemeral
 * runtime state (process-local, not persisted) — carried on the session list +
 * detail so a page reload restores the strip, and pushed live via
 * `session_queue.updated`. `kind` distinguishes a user message ('user', the
 * removable kind) from an internal wake ('wake' — a /loop tick, a plugin, a report).
 */
export interface SessionQueueItem {
  id: string
  /** Originating optimistic UI row, when the sender supplied one. */
  clientMessageId?: string
  kind: 'user' | 'wake'
  /** Lower drains first (user=0, wake=10) — mirrors the backend priority band. */
  priority: number
  /** Addressed agent turn. Absent for user, control, and background events. */
  agentId?: string
  /** Domain weight for an addressed agent turn; higher values run first. */
  agentWeight?: number
  /** Truncated preview of the queued content for the composer strip. */
  preview: string
  queuedAt: string
  /** Where this queued turn came from (provenance), for the composer chip. */
  source?: WakeSource
  /** Runtime delivery seam: Pi steering at the next tool/model boundary, or a new turn. */
  delivery?: 'next-tool' | 'next-turn'
}

export type QueueRemovalResult =
  | { removed: true; content: string; bindings?: MessageBinding[] }
  | { removed: false; reason: 'leased' | 'not_found' }

/** Result of the server-owned "interrupt and send now" queue operation. The
 * item is never removed merely to hand its payload back to a client: `promoted`
 * means the durable delivery lease was acquired and the exact item was handed
 * to the queue drain; every failure leaves it queued. */
export type QueuePromoteResult =
  | { promoted: true }
  | { promoted: false; reason: 'leased' | 'not_found' | 'not_user' }

export interface QueueClearResult {
  removed: number
  retained: string[]
}
