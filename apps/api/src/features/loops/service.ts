/**
 * LOOPS, AS THE TOOL, THE `/loop` COMMAND AND THE STRIP SEE THEM — on top of the trigger engine.
 *
 * A loop is a `loop` trigger: a cron kind for a fixed cadence, a delay kind for a self-paced one.
 * What stays here is what makes it a LOOP rather than any trigger:
 *
 *   - the rules of its shape (a dynamic loop cannot run in a subsession — it reschedules itself
 *     from its own session, which a child cannot do; only a dynamic loop can be rescheduled);
 *   - cancelling one also cancels the wake it has in flight — and ONLY that wake. It used to stop
 *     the whole session, which took every agent's queued turns and killed sub-agents the
 *     loop had nothing to do with;
 *   - the hold the strip shows, which is the trigger's own `rate-limited` hold the loop action's
 *     gate placed (`SessionLoop.heldUntil`), so the strip and the gate cannot disagree.
 */
import { InternalError } from '../../lib/domain-errors'
import { triggerDeliveryKey, type TriggerRecord } from '../triggers/contracts'
import type { TriggerEngine } from '../triggers/engine'
import { clampDelaySeconds } from '../triggers/kinds/delay'
import { isValidCron, localTimeZone } from '../triggers/schedule'
import { LOOP_ACTION } from './action'
import type { LoopTarget, SessionLoop } from './contracts'
import { loopOfTrigger, type LoopPayload } from './record'

export interface LoopServiceDeps {
  triggers: TriggerEngine
  /** Withdraw one delivery: remove it if queued, abort only its run if running. */
  cancelWake?: (userId: string, sessionId: string, deliveryKey: string) => Promise<unknown>
}

type Created = SessionLoop | { error: string }

export function createLoopService(deps: LoopServiceDeps) {
  const { triggers } = deps
  const owned = (id: string, userId: string): TriggerRecord | undefined => {
    const trigger = triggers.get(id)
    return trigger?.userId === userId && trigger.action === LOOP_ACTION ? trigger : undefined
  }
  const asLoop = (result: TriggerRecord | { error: string }): Created =>
    'error' in result ? result : loopOfTrigger(result)
  const owner = (ownerAgentId?: string) =>
    ownerAgentId ? { kind: 'agent' as const, agentId: ownerAgentId } : { kind: 'user' as const }
  const list = (userId: string, sessionId?: string): SessionLoop[] =>
    triggers
      .list({ userId, action: LOOP_ACTION, ...(sessionId ? { sessionId } : {}) })
      .map(loopOfTrigger)

  return {
    async create(input: {
      userId: string
      sessionId: string
      cron: string
      prompt: string
      maintenance?: boolean
      target?: LoopTarget
      ownerAgentId?: string
    }): Promise<Created> {
      if (!isValidCron(input.cron)) return { error: `Invalid cron expression: ${input.cron}` }
      const payload: LoopPayload = {
        prompt: input.prompt,
        maintenance: input.maintenance ?? false,
        target: input.target ?? 'session',
      }
      return asLoop(
        await triggers.arm({
          userId: input.userId,
          sessionId: input.sessionId,
          owner: owner(input.ownerAgentId),
          action: LOOP_ACTION,
          kind: 'cron',
          spec: { cron: input.cron, timeZone: localTimeZone() },
          payload: { ...payload },
        }),
      )
    },

    /** A self-paced loop. Always session-target: pacing happens in its own session. */
    async createDynamic(input: {
      userId: string
      sessionId: string
      prompt: string
      maintenance?: boolean
      ownerAgentId?: string
    }): Promise<Created> {
      const payload: LoopPayload = {
        prompt: input.prompt,
        maintenance: input.maintenance ?? false,
        target: 'session',
      }
      return asLoop(
        await triggers.arm({
          userId: input.userId,
          sessionId: input.sessionId,
          owner: owner(input.ownerAgentId),
          action: LOOP_ACTION,
          kind: 'delay',
          // Unpaced: the watchdog is the longest delay until the agent's first reschedule.
          spec: {},
          payload: { ...payload },
        }),
      )
    },

    get(id: string, userId: string): SessionLoop | undefined {
      const trigger = owned(id, userId)
      return trigger ? loopOfTrigger(trigger) : undefined
    },

    /** A new prompt, cadence or target. A cadence on a dynamic loop makes it fixed. */
    async update(
      id: string,
      userId: string,
      patch: { prompt?: string; cron?: string; target?: LoopTarget },
    ): Promise<Created> {
      const trigger = owned(id, userId)
      if (!trigger) return { error: `Loop ${id} not found or not yours.` }
      if (patch.cron !== undefined && !isValidCron(patch.cron))
        return { error: `Invalid cron expression: ${patch.cron}` }
      const becomesFixed = patch.cron !== undefined
      if (patch.target === 'subsession' && trigger.kind === 'delay' && !becomesFixed)
        return {
          error: `Loop ${id} is dynamic (self-pacing) — give it a cron cadence before moving it to a subsession.`,
        }
      const payload: Partial<LoopPayload> = {
        ...(patch.prompt?.trim() ? { prompt: patch.prompt } : {}),
        ...(patch.target ? { target: patch.target } : {}),
      }
      return asLoop(
        await triggers.update(id, {
          ...(Object.keys(payload).length ? { payload } : {}),
          ...(becomesFixed
            ? {
                kind: 'cron',
                spec: {
                  cron: patch.cron,
                  timeZone:
                    typeof trigger.spec.timeZone === 'string'
                      ? trigger.spec.timeZone
                      : localTimeZone(),
                },
              }
            : {}),
        }),
      )
    },

    /** End a loop, and withdraw the wake it has in flight — nothing else of the session's. */
    async cancel(id: string, userId: string): Promise<boolean> {
      const trigger = owned(id, userId)
      if (!trigger) return false
      const ended = await triggers.end(id, 'cancelled')
      if ('error' in ended)
        throw new InternalError('loop_cancel_failed', `${ended.error} The loop is still running.`)
      if (trigger.state === 'firing' && trigger.payload.target !== 'subsession')
        await deps.cancelWake?.(userId, trigger.sessionId, triggerDeliveryKey(id, trigger.fireSeq))
      return true
    },

    /** The session was deleted; its trigger rows went with it. */
    cancelForSession(sessionId: string): void {
      triggers.forgetSession(sessionId)
    },

    async reschedule(
      id: string,
      userId: string,
      delaySeconds: number,
    ): Promise<{ loop: SessionLoop; appliedSeconds: number } | { error: string }> {
      const trigger = owned(id, userId)
      if (!trigger) return { error: `Loop ${id} not found or not yours.` }
      if (trigger.kind !== 'delay')
        return { error: `Loop ${id} is a fixed loop — it cannot be rescheduled.` }
      if (!Number.isFinite(delaySeconds)) return { error: 'delay_seconds must be a number.' }
      const applied = clampDelaySeconds(delaySeconds)
      const result = await triggers.update(id, { spec: { delaySeconds: applied } })
      return 'error' in result ? result : { loop: loopOfTrigger(result), appliedSeconds: applied }
    },

    /** An extra occurrence now; a fixed loop's cron slot is not consumed. */
    async runNow(id: string, userId: string): Promise<Created> {
      if (!owned(id, userId)) return { error: `Loop ${id} not found or not yours.` }
      return asLoop(await triggers.fireNow(id))
    },

    list,
    listForSession: (userId: string, sessionId: string): SessionLoop[] => list(userId, sessionId),
  }
}

export type LoopService = ReturnType<typeof createLoopService>
