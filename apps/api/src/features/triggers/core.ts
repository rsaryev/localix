/**
 * The state every trigger operation shares, and the three disciplines they all follow.
 *
 *   - `serialize(id, …)` — every operation on ONE trigger runs in order, so a cancel that lands
 *     during a fire's store write cannot interleave with it.
 *   - `store(…)` — a lifecycle write reaches the store FIRST, and its refusal is a sentence to
 *     report, never a silent success. The read model is updated only after (`apply`), so a
 *     refused write changes nothing and there is no rollback to get wrong.
 *   - `schedule(…)` — a timer exists exactly when a trigger waits for a moment rather than for an
 *     event; a busy-held trigger waits for its session to go idle and has none.
 */
import { errorMessage } from '../../lib/errors'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import type { TriggerAction, TriggerKind, TriggerRecord } from './contracts'
import type { TriggerPatch, TriggerRepository } from './repository'
import { createTriggerTimers, type TriggerTimers } from './timers'

export interface TriggerEngineDeps {
  repo: TriggerRepository
  kinds: readonly TriggerKind[]
  actions: readonly TriggerAction[]
  now?: () => Date
  /** A trigger's visible state changed; the host republishes its session's list. */
  onChange?: (trigger: TriggerRecord) => void
  /** A fire's outcome with its failing streak — what a standing "keeps failing" row reads. */
  onFireSettled?: (
    trigger: TriggerRecord,
    result: { ok: boolean; streak: number; error?: string },
  ) => void
  logger?: { warn: (msg: string) => void }
  /** Per-trigger deadlines. Injected by tests; defaults to the partitioned event loop. */
  timers?: (evaluate: (id: string) => Promise<void>) => TriggerTimers
}

export function createEngineCore(deps: TriggerEngineDeps) {
  const live = new Map<string, TriggerRecord>()
  /** Consecutive failed fires per trigger — in memory by design, see `./backoff`. */
  const failures = new Map<string, number>()
  /** The settle of each fire still delivering — what an event waits on so fires never overlap. */
  const inflight = new Map<string, Promise<void>>()
  const warn = (msg: string) => deps.logger?.warn(msg)
  // Bound by the fire cycle once it exists; a deadline only fires after construction.
  let evaluate: (id: string) => Promise<void> = async () => {}
  const timers = (deps.timers ?? createTriggerTimers)((id) => evaluate(id))

  const schedule = (trigger: TriggerRecord) => {
    const waitsForTime =
      trigger.nextDueAt !== null &&
      (trigger.state === 'armed' ||
        (trigger.state === 'held' && trigger.holdReason === 'rate-limited'))
    if (waitsForTime) timers.scheduleAt(trigger.id, Date.parse(trigger.nextDueAt!))
    else timers.cancel(trigger.id)
  }

  return {
    repo: deps.repo,
    now: deps.now ?? (() => new Date()),
    kinds: new Map(deps.kinds.map((kind) => [kind.id, kind])),
    actions: new Map(deps.actions.map((action) => [action.id, action])),
    live,
    failures,
    inflight,
    serialize: createKeyedSerializer(),
    timers,
    warn,
    schedule,
    bindEvaluate(fn: (id: string) => Promise<void>) {
      evaluate = fn
    },

    apply(trigger: TriggerRecord, patch: TriggerPatch): TriggerRecord {
      const next = { ...trigger, ...patch }
      live.set(next.id, next)
      return next
    },

    changed(trigger: TriggerRecord) {
      try {
        deps.onChange?.(trigger)
      } catch (error) {
        warn(`trigger change listener failed: ${errorMessage(error)}`)
      }
    },

    fireSettled(...args: Parameters<NonNullable<TriggerEngineDeps['onFireSettled']>>) {
      try {
        deps.onFireSettled?.(...args)
      } catch (error) {
        warn(`trigger settle listener failed: ${errorMessage(error)}`)
      }
    },

    forget(id: string) {
      live.delete(id)
      failures.delete(id)
      timers.cancel(id)
    },

    /** Write a lifecycle change; answer the sentence to report when the store refused it. */
    async store(what: string, write: () => Promise<boolean | void>): Promise<string | null> {
      try {
        return (await write()) === false
          ? `${what} did not apply: the trigger changed meanwhile.`
          : null
      } catch (error) {
        warn(`${what} could not be stored: ${errorMessage(error)}`)
        return `The trigger store could not be written, so ${what} did not take effect.`
      }
    },
  }
}

export type EngineCore = ReturnType<typeof createEngineCore>
