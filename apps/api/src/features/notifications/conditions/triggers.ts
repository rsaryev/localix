import type { TriggerRecord } from '../../triggers/contracts'
import type { WakeOutcome, WakeShape } from '../../triggers/delivery'
import type { ConditionJournal, ConditionRaise } from './condition'
import { createConditions, headline } from './condition'

/**
 * WHAT THE TRIGGER ENGINE COULD NOT DO, told to a person.
 *
 * Two facts with different shapes, which is why they are recorded differently:
 *
 *   - A LOOP THAT KEEPS FAILING is a standing condition (`trigger:<id>:`). The engine already backs a
 *     failing streak off and records `lastError`, but only the loop chip showed it, and only to
 *     someone looking at that chat. Raised once the streak reaches {@link FAILING_STREAK} (one
 *     failure is weather), settled by the next fire that succeeds, retired when the loop ends.
 *   - A WAKE THAT DID NOT LAND is an EVENT: nothing stays broken, one delivery did not happen. It is
 *     a plain error row keyed by the delivery (`delivery:<deliveryKey>`), so a retried fire — the
 *     same delivery key — is the same row. A `gone` miss (the chat was deleted) is ordinary and is
 *     not recorded: the wake had nobody left to reach.
 */

export const FAILING_STREAK = 2

export interface FireSettled {
  ok: boolean
  /** Consecutive failed fires including this one; 0 after a success. */
  streak: number
  error?: string
}

export interface TriggerConditions {
  fireSettled(trigger: TriggerRecord, result: FireSettled): void
  /** The loop ended (cancelled, exhausted): nothing is left to fix. */
  loopEnded(userId: string, triggerId: string): void
  /**
   * The loop's chat has a route whose provider account is gone and no live account can take it:
   * every fire would fail until the person connects the provider again or picks another model.
   * Settled with the loop's other rows by the next fire that succeeds.
   */
  routeStranded(trigger: TriggerRecord): void
  /**
   * The loop was stopped because the agent that armed it was deleted. Its record stays; nothing
   * will fire it again, so the row is information, not a problem to settle.
   */
  ownerGone(trigger: TriggerRecord): void
}

/** Only loops are reported: a monitor's and an exit notice's failures belong to their own work. */
const reported = (trigger: TriggerRecord) => trigger.action === 'loop'

/** A loop's row comes from its chat, and offers to open it. */
const fromLoop = ({ sessionId }: TriggerRecord): Pick<ConditionRaise, 'origin' | 'actions'> => ({
  origin: { kind: 'session', sessionId, projectId: null, label: 'Loop' },
  actions: [
    {
      id: 'open-session',
      label: 'Open chat',
      kind: 'navigate',
      target: { kind: 'session', sessionId, projectId: null },
      available: true,
    },
  ],
})

export function createTriggerConditions(journal: ConditionJournal): TriggerConditions {
  const conditions = createConditions(journal)
  const subject = (trigger: Pick<TriggerRecord, 'id'>) => ['trigger', trigger.id]
  return {
    fireSettled(trigger, result) {
      if (!reported(trigger)) return
      if (result.ok) return conditions.clear(trigger.userId, subject(trigger))
      if (result.streak < FAILING_STREAK) return
      const prompt = typeof trigger.payload.prompt === 'string' ? trigger.payload.prompt : ''
      conditions.raise(trigger.userId, {
        subject: subject(trigger),
        // One row per loop: each failure words itself differently, and the loop is the problem.
        problem: 'failing',
        severity: 'error',
        title: 'Could not run a scheduled loop',
        body: [
          prompt && `“${headline(prompt, 80)}”`,
          `Failed ${result.streak} times in a row${result.error ? `: ${result.error}` : '.'}`,
        ]
          .filter(Boolean)
          .join('\n'),
        ...fromLoop(trigger),
      })
    },
    routeStranded(trigger) {
      if (!reported(trigger)) return
      conditions.raise(trigger.userId, {
        subject: [...subject(trigger), 'route'],
        problem: 'route-stranded',
        severity: 'error',
        title: 'A scheduled loop has no model to run on',
        body: 'The provider account its chat used was removed. Connect the provider again or pick another model in the chat.',
        ...fromLoop(trigger),
      })
    },
    ownerGone(trigger) {
      if (!reported(trigger)) return
      const prompt = typeof trigger.payload.prompt === 'string' ? trigger.payload.prompt : ''
      conditions.raise(trigger.userId, {
        subject: [...subject(trigger), 'agent-gone'],
        problem: 'agent-gone',
        severity: 'info',
        title: 'A scheduled loop stopped: its agent was deleted',
        body: prompt
          ? `“${headline(prompt, 80)}” will not run again. Start a new loop in the chat if you still need it.`
          : 'It will not run again. Start a new loop in the chat if you still need it.',
        ...fromLoop(trigger),
      })
    },
    loopEnded: (userId, triggerId) =>
      conditions.clear(userId, subject({ id: triggerId }), 'cancelled'),
  }
}

export type UndeliveredOutcome = Exclude<WakeOutcome, { status: 'delivered' }>

/** The delivery's `onUndelivered`: one error row per wake that did not land. */
export function createWakeNotices(journal: Pick<ConditionJournal, 'record'>, now = Date.now) {
  return (request: WakeShape, subject: string, outcome: UndeliveredOutcome): void => {
    if (outcome.status === 'missed' && outcome.reason === 'gone') return
    const reason = outcome.status === 'missed' ? `missed: ${outcome.reason}` : outcome.detail
    journal.record(request.userId, {
      // A keyless wake has no identity to replay under: a fresh key, and identical repeats fold.
      key: request.deliveryKey
        ? `delivery:${encodeURIComponent(request.deliveryKey)}`
        : `delivery:anon:${encodeURIComponent(request.sessionId)}:${now()}`,
      ...(request.deliveryKey ? {} : { coalesce: true }),
      topic: 'application.notification',
      category: 'system',
      severity: outcome.status === 'failed' ? 'error' : 'warning',
      title: 'Could not wake the conversation',
      body: `${subject} — ${reason}`,
      origin: { kind: 'session', sessionId: request.sessionId, projectId: null },
    })
  }
}
