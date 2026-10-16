/**
 * WHAT A LOOP FIRE DOES — the `loop` trigger action.
 *
 * The scheduler (`features/triggers`) decides when; this decides what the fire says, where it
 * runs, and whether the session can take it now:
 *
 *   gate     a SESSION-target fire waits while its session is busy (a queued wake would pile up
 *            behind the slow turn) or while the provider route of the participant it is
 *            addressed to is rate-limited (it would burn an exhausted quota); a subsession fire
 *            touches neither and is never gated;
 *   content  the task, with the self-pacing instruction for a delay loop and the previous round's
 *            handoff for a subsession one;
 *   deliver  into the owning session through the wake queue — addressed to the participant that
 *            armed it — or into a fresh child session.
 */
import type { FireGate, FireOutcome, TriggerAction, TriggerRecord } from '../triggers/contracts'
import type { LoopFireOutcome, SessionLoop } from './contracts'
import { loopOfTrigger } from './record'
import { buildLoopWake } from './wake'

export const LOOP_ACTION = 'loop'

export interface LoopActionDeps {
  /** True while the session has a run in flight or one about to start. */
  isSessionBusy: (sessionId: string) => boolean
  /**
   * Epoch ms the provider route of the participant this fire is addressed to is exhausted until,
   * or null. `agentId` absent: nobody is addressed and the conversation chooses the speaker.
   */
  rateLimitedUntilMs: (
    userId: string,
    sessionId: string,
    agentId?: string,
  ) => Promise<number | null>
  /** Inject into the owning session and resolve when that run ends. */
  wakeSession: (
    loop: SessionLoop,
    wake: { content: string; extraDisabledTools: string[]; deliveryKey: string },
  ) => Promise<LoopFireOutcome>
  /** Run the round in a fresh child session and resolve when it ends. */
  runSubsession: (
    loop: SessionLoop,
    content: string,
    extraDisabledTools: string[],
  ) => Promise<LoopFireOutcome>
  now?: () => number
}

export function createLoopAction(deps: LoopActionDeps): TriggerAction {
  const now = deps.now ?? Date.now
  return {
    id: LOOP_ACTION,

    async gate(trigger: TriggerRecord): Promise<FireGate | null> {
      if (trigger.payload.target === 'subsession') return null
      if (deps.isSessionBusy(trigger.sessionId)) return { hold: 'busy' }
      // The route asked about is the ADDRESSEE's — the same participant `fire` wakes below — so
      // another participant's exhausted provider never holds this fire.
      const addressee = loopOfTrigger(trigger).ownerAgentId
      const until = await deps.rateLimitedUntilMs(trigger.userId, trigger.sessionId, addressee)
      return until != null && until > now() ? { hold: 'rate-limited', untilMs: until } : null
    },

    async fire(trigger, { deliveryKey }): Promise<FireOutcome> {
      const loop = loopOfTrigger(trigger)
      const { content, extraDisabledTools } = buildLoopWake(loop)
      const outcome =
        loop.target === 'subsession'
          ? await deps.runSubsession(loop, content, extraDisabledTools)
          : await deps.wakeSession(loop, { content, extraDisabledTools, deliveryKey })
      return {
        ok: outcome.ok,
        ...(outcome.error ? { error: outcome.error } : {}),
        ...(outcome.skipped ? { skipped: true as const } : {}),
        ...(outcome.handoff ? { payload: { handoff: outcome.handoff } } : {}),
      }
    },
  }
}
