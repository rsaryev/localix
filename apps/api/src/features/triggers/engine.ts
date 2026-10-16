/**
 * THE TRIGGER ENGINE: the lifecycle of every trigger, for every kind and every action.
 *
 *   hydrate  recover what a dead process left behind (`./recovery`);
 *   start    set the deadlines, and tell the owners of what the restart ended;
 *   arm      validate → compute the first due time → insert → schedule;
 *   update   new timing and/or payload, due time recomputed from now;
 *   fireNow  an extra fire that consumes no slot and never overlaps a running one;
 *   emit     an event kind's fire, with what its host saw;
 *   end      compare-and-set to `ended` → drop the deadline.
 *
 * WHEN a trigger fires, and what its outcome does, is the fire cycle's (`./cycle`); the shared
 * read model and the write discipline both follow are the core's (`./core`).
 */
import { randomUUID } from 'node:crypto'

import { errorMessage } from '../../lib/errors'
import type { TriggerOwner, TriggerRecord } from './contracts'
import { createEngineCore, type TriggerEngineDeps } from './core'
import { createFireCycle } from './cycle'
import { ENDED_RETENTION_MS, recoverTrigger } from './recovery'
import type { TriggerPatch } from './repository'

export type { TriggerEngineDeps } from './core'
export type TriggerResult<T> = T | { error: string }

export interface ArmInput {
  userId: string
  sessionId: string
  owner: TriggerOwner
  action: string
  kind: string
  spec: Record<string, unknown>
  payload: Record<string, unknown>
}

export function createTriggerEngine(deps: TriggerEngineDeps) {
  const core = createEngineCore(deps)
  const { repo, now, kinds, actions, live, serialize } = core
  const cycle = createFireCycle(core)
  return {
    /**
     * Load live triggers and recover what a dead process left behind. Once, at boot. Sets no
     * deadline: nothing fires before `start`, which runs after the server listens.
     */
    async hydrate(): Promise<void> {
      const at = now().toISOString()
      await repo
        .pruneEnded(new Date(now().getTime() - ENDED_RETENTION_MS).toISOString())
        .catch((error: unknown) => core.warn(`ended triggers not pruned: ${errorMessage(error)}`))
      const known = { kinds, actions: new Set(actions.keys()) }
      for (const stored of await repo.listLive()) {
        const recovery = recoverTrigger(stored, known, at)
        if (recovery && 'end' in recovery) {
          await repo.transition(
            stored.id,
            {},
            { state: 'ended', endReason: recovery.end, updatedAt: at },
          )
          continue
        }
        if (recovery) await repo.transition(stored.id, {}, recovery.patch)
        live.set(stored.id, { ...stored, ...recovery?.patch })
      }
    },

    /**
     * Set every live trigger's deadline — a past-due one fires once, now. After the server
     * listens: a fire can open a turn.
     */
    async start(): Promise<void> {
      for (const trigger of live.values()) core.schedule(trigger)
    },

    async arm(input: ArmInput): Promise<TriggerResult<TriggerRecord>> {
      const kind = kinds.get(input.kind)
      if (!kind) return { error: `Unknown trigger kind: ${input.kind}` }
      if (!actions.has(input.action)) return { error: `Unknown trigger action: ${input.action}` }
      const at = now()
      const due = kind.firstDue(input.spec, at)
      if (!due && kind.clock === 'time') return { error: 'That schedule never fires.' }
      const trigger: TriggerRecord = {
        ...input,
        id: randomUUID(),
        state: 'armed',
        holdReason: null,
        endReason: null,
        nextDueAt: due?.toISOString() ?? null,
        fireSeq: 0,
        fireCount: 0,
        lastFiredAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      }
      const refused = await core.store(`arming trigger ${trigger.id}`, () => repo.insert(trigger))
      if (refused) return { error: refused }
      live.set(trigger.id, trigger)
      core.schedule(trigger)
      core.changed(trigger)
      return trigger
    },

    update: (
      id: string,
      change: { kind?: string; spec?: Record<string, unknown>; payload?: Record<string, unknown> },
    ): Promise<TriggerResult<TriggerRecord>> =>
      serialize(id, async () => {
        const trigger = live.get(id)
        if (!trigger) return { error: `Trigger ${id} is not active.` }
        const kind = kinds.get(change.kind ?? trigger.kind)
        if (!kind) return { error: `Unknown trigger kind: ${change.kind}` }
        const at = now()
        const patch: TriggerPatch = { updatedAt: at.toISOString() }
        if (change.payload) patch.payload = { ...trigger.payload, ...change.payload }
        if (change.kind || change.spec) {
          const spec = change.spec ?? trigger.spec
          const due = kind.firstDue(spec, at)
          if (!due && kind.clock === 'time') return { error: 'That schedule never fires.' }
          Object.assign(patch, { kind: kind.id, spec, nextDueAt: due?.toISOString() ?? null })
          // A firing trigger keeps firing; its settle re-arms at this new time.
          if (trigger.state === 'held') Object.assign(patch, { state: 'armed', holdReason: null })
        }
        const refused = await core.store(`updating trigger ${id}`, () =>
          repo.transition(id, { states: ['armed', 'held', 'firing'] }, patch),
        )
        if (refused) return { error: refused }
        const next = core.apply(trigger, patch)
        if (next.state !== 'firing') core.schedule(next)
        core.changed(next)
        return next
      }),

    fireNow: (id: string): Promise<TriggerResult<TriggerRecord>> =>
      serialize(id, async () => {
        const trigger = live.get(id)
        if (!trigger) return { error: `Trigger ${id} is not active.` }
        if (trigger.state === 'firing') return { error: `Trigger ${id} is firing right now.` }
        const refused = await cycle.fire(trigger, false)
        return refused ? { error: refused } : live.get(id)!
      }),

    /** An event kind's host reports what happened; answers the refusal to report, or null. */
    emit: (id: string, event: Record<string, unknown>): Promise<string | null> =>
      cycle.emit(id, event),

    end: (id: string, reason: string): Promise<TriggerResult<TriggerRecord>> =>
      serialize(id, async () => {
        const trigger = live.get(id)
        if (!trigger) return { error: `Trigger ${id} is not active.` }
        const patch: TriggerPatch = {
          state: 'ended',
          endReason: reason,
          updatedAt: now().toISOString(),
        }
        const refused = await core.store(`ending trigger ${id}`, () =>
          repo.transition(id, { states: ['armed', 'held', 'firing'] }, patch),
        )
        if (refused) return { error: refused }
        core.forget(id)
        const ended = { ...trigger, ...patch }
        core.changed(ended)
        return ended
      }),

    /** The session was deleted; its rows went with the foreign-key cascade. */
    forgetSession(sessionId: string): void {
      // Deleting from a Map while iterating it is safe: visited entries are not revisited.
      for (const trigger of live.values())
        if (trigger.sessionId === sessionId) core.forget(trigger.id)
    },

    /** The session went idle: whatever it held for being busy may fire now. */
    poke(sessionId: string): void {
      for (const trigger of live.values())
        if (trigger.sessionId === sessionId && trigger.holdReason === 'busy')
          void cycle.evaluate(trigger.id)
    },

    get: (id: string): TriggerRecord | undefined => live.get(id),

    /** Live triggers. Every caller that answers a user names the user; only boot lists all. */
    list: (filter: { userId?: string; sessionId?: string; action?: string }): TriggerRecord[] =>
      [...live.values()].filter(
        (trigger) =>
          (filter.userId === undefined || trigger.userId === filter.userId) &&
          (filter.sessionId === undefined || trigger.sessionId === filter.sessionId) &&
          (filter.action === undefined || trigger.action === filter.action),
      ),

    /** The deadline's entry point, public so a test can drive a fake clock. */
    evaluate: cycle.evaluate,
    close: (): Promise<void> => core.timers.close(),
  }
}

export type TriggerEngine = ReturnType<typeof createTriggerEngine>
