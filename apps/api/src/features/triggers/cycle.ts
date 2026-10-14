/**
 * ONE FIRE CYCLE: is it due → may it fire → fire → settle.
 *
 *   evaluate  due? then ask the action's gate; a gated occurrence is skipped or held as the
 *             kind says, otherwise it fires;
 *   fire      advance the due time and bump the fire in ONE store write, then deliver without
 *             holding the trigger — a subsession round takes minutes, and a cancel must not wait;
 *   settle    record the outcome, back a failing streak off, re-arm — or end, when the action says
 *             this fire was the last. Matched on the fire it belongs to, so the outcome of a fire
 *             that was cancelled or superseded lands nowhere.
 *
 * An event kind enters at `emit` instead of `evaluate`: no due time, no gate, the same fire.
 */
import { errorMessage } from '../../lib/errors'
import { fireBackoffMs } from './backoff'
import { triggerDeliveryKey, type FireOutcome, type TriggerRecord } from './contracts'
import type { EngineCore } from './core'
import type { TriggerPatch } from './repository'

/** An emit that found a fire still delivering: wait for it, then try again. */
const BUSY = Symbol('busy')

export function createFireCycle(core: EngineCore) {
  const { repo, now, kinds, actions, live, failures, serialize, warn } = core

  const settle = (id: string, seq: number, outcome: FireOutcome) =>
    serialize(id, async () => {
      const trigger = live.get(id)
      if (trigger?.state !== 'firing' || trigger.fireSeq !== seq) return
      const patch: TriggerPatch = outcome.end
        ? { state: 'ended', endReason: outcome.end, updatedAt: now().toISOString() }
        : { state: 'armed', updatedAt: now().toISOString() }
      if (outcome.payload) patch.payload = { ...trigger.payload, ...outcome.payload }
      // A DECLINED fire is not an outcome: the previous status stands and the streak is untouched.
      if (!outcome.skipped) {
        patch.lastStatus = outcome.ok ? 'ok' : 'error'
        patch.lastError = outcome.ok ? null : (outcome.error ?? 'the fire failed')
        const streak = outcome.ok ? 0 : (failures.get(id) ?? 0) + 1
        if (streak === 0) failures.delete(id)
        else failures.set(id, streak)
        core.fireSettled(trigger, { ok: outcome.ok, streak, error: outcome.error })
        // Monotonic: a backoff only ever pushes the next occurrence LATER than the schedule.
        const earliest = now().getTime() + fireBackoffMs(streak)
        const scheduled = trigger.nextDueAt ? Date.parse(trigger.nextDueAt) : 0
        if (kinds.get(trigger.kind)!.backsOff && streak > 0 && earliest > scheduled)
          patch.nextDueAt = new Date(earliest).toISOString()
      }
      exhaustIfNoDue(trigger, patch)
      const next = core.apply(trigger, patch)
      // Best-effort: a lost settle leaves the row `firing`, which the next boot re-arms.
      await repo
        .transition(id, { states: ['firing'], fireSeq: seq }, patch)
        .catch((error: unknown) => warn(`trigger ${id} settle not stored: ${errorMessage(error)}`))
      land(next)
    })

  /**
   * A schedule with no next moment can never fire again: it ENDS rather than idling unseen. An
   * event kind never has a moment — it waits for its host — so null is its resting state.
   */
  const exhaustIfNoDue = (trigger: TriggerRecord, patch: TriggerPatch) => {
    if (kinds.get(patch.kind ?? trigger.kind)!.clock === 'event') return
    const due = 'nextDueAt' in patch ? patch.nextDueAt : trigger.nextDueAt
    if (due === null && patch.state === 'armed')
      Object.assign(patch, { state: 'ended', endReason: 'exhausted' })
  }

  const land = (next: TriggerRecord) => {
    if (next.state === 'ended') core.forget(next.id)
    else core.schedule(next)
    core.changed(next)
  }

  /** Start one fire; answers the refusal to report, or null. Call inside `serialize`. */
  const fire = async (
    trigger: TriggerRecord,
    consumeSlot: boolean,
    event?: Record<string, unknown>,
  ): Promise<string | null> => {
    const at = now()
    const seq = trigger.fireSeq + 1
    const patch: TriggerPatch = {
      state: 'firing',
      holdReason: null,
      fireSeq: seq,
      fireCount: trigger.fireCount + 1,
      lastFiredAt: at.toISOString(),
      updatedAt: at.toISOString(),
      // Advanced BEFORE delivering, so a slow fire cannot fire twice.
      ...(consumeSlot
        ? { nextDueAt: kinds.get(trigger.kind)!.nextDue(trigger.spec, at)?.toISOString() ?? null }
        : {}),
    }
    const refused = await core.store(`firing trigger ${trigger.id}`, () =>
      repo.transition(trigger.id, { states: ['armed', 'held'], fireSeq: trigger.fireSeq }, patch),
    )
    if (refused) return refused
    const firing = core.apply(trigger, patch)
    core.timers.cancel(firing.id)
    core.changed(firing)
    const settled = actions
      .get(firing.action)!
      .fire(firing, {
        deliveryKey: triggerDeliveryKey(firing.id, seq),
        ...(event ? { event } : {}),
      })
      .catch((error: unknown): FireOutcome => ({ ok: false, error: errorMessage(error) }))
      .then((outcome) => settle(firing.id, seq, outcome))
      .catch((error: unknown) => warn(`trigger ${firing.id} settle failed: ${errorMessage(error)}`))
      .finally(() => {
        if (core.inflight.get(firing.id) === settled) core.inflight.delete(firing.id)
      })
    core.inflight.set(firing.id, settled)
    return null
  }

  /** The deadline's entry point: is this trigger due, and may it fire? */
  const evaluate = (id: string) =>
    serialize(id, async () => {
      const trigger = live.get(id)
      if (!trigger || trigger.state === 'firing' || trigger.nextDueAt === null) return
      const at = now()
      const busyHeld = trigger.state === 'held' && trigger.holdReason === 'busy'
      if (!busyHeld && Date.parse(trigger.nextDueAt) > at.getTime()) return core.schedule(trigger)
      // Awaited: a loop's gate reads its session for the addressee's route. Still inside
      // `serialize`, so a cancel issued meanwhile lands after this evaluation, not during it.
      const gate = (await actions.get(trigger.action)!.gate?.(trigger)) ?? null
      if (!gate) {
        const refused = await fire(trigger, true)
        if (refused) warn(refused)
        return
      }
      const updatedAt = at.toISOString()
      const patch: TriggerPatch =
        kinds.get(trigger.kind)!.onGated === 'skip'
          ? {
              state: 'armed',
              holdReason: null,
              nextDueAt: kinds.get(trigger.kind)!.nextDue(trigger.spec, at)?.toISOString() ?? null,
              updatedAt,
            }
          : gate.hold === 'busy'
            ? { state: 'held', holdReason: 'busy', updatedAt }
            : {
                state: 'held',
                holdReason: 'rate-limited',
                nextDueAt: new Date(gate.untilMs).toISOString(),
                updatedAt,
              }
      exhaustIfNoDue(trigger, patch)
      const next = core.apply(trigger, patch)
      // Best-effort: a lost hold is re-asked at the next evaluation, which is all a hold is.
      await repo
        .transition(id, { states: ['armed', 'held'] }, patch)
        .catch((error: unknown) => warn(`trigger ${id} hold not stored: ${errorMessage(error)}`))
      land(next)
    })

  /**
   * An event kind's entry point: fire NOW with what happened. Never over a fire still delivering —
   * two lines arriving together are two fires in order, not two racing wakes — and never gated:
   * an event is news, and "later" is the wake queue's to hold, not the trigger's.
   */
  const emit = async (id: string, event: Record<string, unknown>): Promise<string | null> => {
    for (;;) {
      await core.inflight.get(id)
      const result = await serialize(id, async (): Promise<string | null | typeof BUSY> => {
        const trigger = live.get(id)
        if (!trigger) return `Trigger ${id} is not active.`
        return trigger.state === 'firing' ? BUSY : fire(trigger, false, event)
      })
      if (result !== BUSY) return result
    }
  }

  core.bindEvaluate(evaluate)
  return { evaluate, fire, emit }
}
