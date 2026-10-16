/**
 * A loop IS a `loop` trigger; this is the one translation between the two shapes.
 *
 * The trigger keeps the timing (a cron kind with its zone, or a delay kind) and the scheduler's
 * bookkeeping; the loop's own parameters — prompt, maintenance, target, handoff — ride in the
 * payload, which only the loop action reads. Every loop consumer (the tool, the prompt, the strip)
 * sees `SessionLoop` and never learns that the storage is shared with other producers.
 */
import type { TriggerRecord } from '../triggers/contracts'
import type { LoopTarget, SessionLoop } from './contracts'
import { readLoopHandoff } from './handoff'

/** The loop-owned half of a trigger. */
export interface LoopPayload {
  prompt: string
  maintenance: boolean
  target: LoopTarget
  handoff?: unknown
}

export function loopOfTrigger(trigger: TriggerRecord): SessionLoop {
  const payload = trigger.payload as Partial<LoopPayload>
  // Re-validated rather than trusted: a handoff was written by a model's reply, and one that no
  // longer parses must leave the next round inheriting NOTHING rather than a malformed object.
  const handoff =
    payload.handoff === undefined ? null : readLoopHandoff(JSON.stringify(payload.handoff))
  const delay = trigger.spec.delaySeconds
  return {
    id: trigger.id,
    userId: trigger.userId,
    sessionId: trigger.sessionId,
    ...(trigger.owner.kind === 'agent' ? { ownerAgentId: trigger.owner.agentId } : {}),
    kind: trigger.kind === 'cron' ? 'fixed' : 'dynamic',
    cron: trigger.kind === 'cron' ? String(trigger.spec.cron) : null,
    prompt: String(payload.prompt ?? ''),
    maintenance: payload.maintenance === true,
    ...(handoff ? { handoff } : {}),
    ...(typeof delay === 'number' ? { delaySeconds: delay } : {}),
    createdAt: trigger.createdAt,
    nextRunAt: trigger.nextDueAt ?? trigger.updatedAt,
    target: payload.target === 'subsession' ? 'subsession' : 'session',
    lastRunAt: trigger.lastFiredAt,
    lastStatus: trigger.lastStatus,
    lastError: trigger.lastError,
    runCount: trigger.fireCount,
    ...(trigger.state === 'held' && trigger.holdReason === 'rate-limited' && trigger.nextDueAt
      ? { heldUntil: trigger.nextDueAt }
      : {}),
  }
}
