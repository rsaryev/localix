/**
 * WHEN SOMETHING WAKES A SESSION, AND WHETHER THE WAKE LANDED.
 *
 * A trigger separates the two halves every scheduled wake used to fuse:
 *
 *   - its KIND owns timing — a cron slot, a delay the agent chose — and nothing else;
 *   - its ACTION owns what a fire does — a loop's prompt, its target, its handoff.
 *
 * The scheduler knows kinds and states; it never reads a payload. An action knows its payload
 * and gates; it never computes a due time. A new wake producer is then a new action (and, when
 * its timing is new, a new kind) rather than a second scheduler.
 *
 * States, and what moves between them:
 *
 *   armed  --due, admitted-->  firing  --settled-->  armed | ended
 *   armed  --event-->          firing  (an event kind: its host reports what happened)
 *   armed  --due, gated-->     held     (busy: until the session goes idle;
 *                                        rate-limited: until the cooldown, which is persisted)
 *   any    --cancel-->         ended
 */

export type TriggerState = 'armed' | 'held' | 'firing' | 'ended'
export type HoldReason = 'busy' | 'rate-limited'
export type FireStatus = 'ok' | 'error'

/** Who armed it. An agent's own triggers are the ones it may end without being asked. */
export type TriggerOwner =
  | { kind: 'agent'; agentId: string }
  | { kind: 'user' }
  | { kind: 'plugin'; ref: string }
  | { kind: 'system'; ref: string }

export interface TriggerRecord {
  id: string
  userId: string
  sessionId: string
  owner: TriggerOwner
  /** What a fire does; resolved against the engine's action registry. */
  action: string
  /** How its due time is computed; resolved against the kind registry. */
  kind: string
  state: TriggerState
  holdReason: HoldReason | null
  endReason: string | null
  /** The kind's own timing parameters (a cron and its zone, a delay). */
  spec: Record<string, unknown>
  /** The action's own parameters (a loop's prompt). Opaque to the scheduler. */
  payload: Record<string, unknown>
  /** ISO time of the next fire; null only while held for a busy session. */
  nextDueAt: string | null
  /** Bumped by every fire, and part of its delivery key: a retried fire is the same delivery. */
  fireSeq: number
  fireCount: number
  lastFiredAt: string | null
  lastStatus: FireStatus | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

/**
 * The idempotency key of one fire. The wake queue records it with the wake row, so a fire that
 * is retried after a crash is recognised as the same delivery rather than a second one.
 */
export const triggerDeliveryKey = (id: string, fireSeq: number): string => `trg:${id}:${fireSeq}`

/**
 * TIMING. A kind answers when a trigger is next due — at creation, after a fire, and after a
 * restart — and how it treats an occurrence it could not deliver.
 */
export interface TriggerKind {
  readonly id: string
  /**
   * What makes it fire. A `time` kind fires at the moments it computes; an `event` kind has no
   * moment at all — a process exiting, a line arriving — and fires only when its host reports the
   * event (`TriggerEngine.emit`). An event kind's due time stays null, and null does NOT exhaust
   * it: it is waiting for news, not out of slots.
   */
  readonly clock: 'time' | 'event'
  /**
   * What a restart does to it. A `resume` kind's schedule is data, so the next process carries it
   * on from its row. An `end` kind was fed by something the old process owned (a live command,
   * a child process), which died with it: it ENDS with `restart`, silently.
   */
  readonly onRestart: 'resume' | 'end'
  /** The first due time, or null when the spec can never fire (always null for an event kind). */
  firstDue(spec: Record<string, unknown>, now: Date): Date | null
  /**
   * The due time to set when a fire STARTS, so a slow fire cannot fire twice. For a cron this is
   * its next slot; for a delay it is a watchdog — the same delay again — which is what brings a
   * self-pacing trigger back after a failed fire, a restart, or an agent that forgot to reschedule.
   */
  nextDue(spec: Record<string, unknown>, now: Date): Date | null
  /**
   * What happens to an occurrence the action gated. `skip` gives the slot up (a cron slot is a
   * moment, and firing it late is a different occurrence); `hold` keeps it due until admitted.
   */
  readonly onGated: 'skip' | 'hold'
  /** Consecutive failures push the next occurrence out (see `./backoff`). Delays are the agent's. */
  readonly backsOff: boolean
}

/** Why an action will not take a fire right now. */
export type FireGate =
  | { hold: 'busy' }
  /** Epoch ms the cooldown lasts until. */
  | { hold: 'rate-limited'; untilMs: number }

export interface FireOutcome {
  ok: boolean
  error?: string
  /**
   * The fire was DECLINED, not attempted. It is neither a success nor a failure: it leaves the
   * previous status standing and does not count toward the backoff.
   */
  skipped?: true
  /** A payload patch the action wants kept (a subsession round's handoff to the next one). */
  payload?: Record<string, unknown>
  /**
   * This fire was the trigger's last: end it with this reason. A monitor whose condition held, a
   * process that exited — the action is the one that knows the watch is over.
   */
  end?: string
}

/** One fire, as the action receives it. */
export interface FireContext {
  /** Identifies the fire to the wake queue: a repeat is the same delivery. */
  deliveryKey: string
  /** What an event kind's host reported; absent for a fire that a moment caused. */
  event?: Record<string, unknown>
}

/** WHAT A FIRE DOES. Registered per action id; the only code that reads a payload. */
export interface TriggerAction {
  readonly id: string
  /**
   * Asked before every scheduled fire; absent means always admitted. Events are never gated.
   * May be async: a loop's gate reads the addressed agent's route from its session.
   */
  gate?(trigger: TriggerRecord): FireGate | null | Promise<FireGate | null>
  /** Deliver the fire. */
  fire(trigger: TriggerRecord, fire: FireContext): Promise<FireOutcome>
}
