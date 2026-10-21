/**
 * THE ONE PATH A WAKE TAKES FROM ITS PRODUCER TO THE SESSION, AND WHAT IT ANSWERS.
 *
 * Every producer — a trigger's fire, a plugin's watcher, a reaction, a finished child — is
 * fire-and-forget by design: a wake must never fail the thing that caused it. Each one used to
 * wrap the chat wake by hand (`.then(res => { if (!res.delivered) log(…) }).catch(…)`), five
 * copies with five spellings of "it did not land", and the plugin monitor's copy skipped a busy
 * session outright — the one case the wake queue exists to hold. A producer now names its
 * subject and hands the request here:
 *
 *   deliver  await the answer as one of delivered | missed | failed — never a throw;
 *   send     the same, detached, with a wake that did not land logged against its subject.
 *
 * No retry, deliberately: a re-wake has to be recognised as the same delivery as one that DID
 * land, and only its delivery key can say so — which is the producer's to choose (a trigger's
 * fire is `trg:<id>:<seq>`, see `triggerWake`).
 *
 * Durable when given an `outbox`: a keyed wake is recorded before it is sent and leaves when the
 * session's queue admits it (in the queue's own transaction) or delivery answers, so a crash in
 * between is redelivered at boot (`redeliver`) under the same key instead of being lost. A
 * once-ever `receipt` delivery (a child's report) keeps its own recovery and is not outboxed.
 */
import { agentParticipant, type ParticipantRef } from '../../db/participant'
import { errorMessage } from '../../lib/errors'
import type { TriggerRecord } from './contracts'
import type { WakeOutbox } from './wake-outbox-repository'

/**
 * A wake request, as far as delivery needs to read it. The host's own request type satisfies it;
 * `source` stays the host's vocabulary (its type parameter), because this module does not own it.
 */
export interface WakeShape<S extends string = string> {
  userId: string
  sessionId: string
  content: string
  source: S
  to?: { participant: ParticipantRef; handle?: string }
  deliveryKey?: string
  /** Delivered together with the other queued wakes of this key (a monitor's fires). */
  coalesce?: string
  /** Admitted once ever (a child's report); its producer keeps its own recovery. */
  receipt?: true
}

/** What the host's wake primitive answers. `missed: 'unreadable'` is its store failing. */
export interface WakeAnswer {
  delivered: boolean
  missed?: string
  detail?: string
}

export type WakeOutcome =
  | { status: 'delivered' }
  /** The session is gone or cannot take a wake — ordinary, and nothing to retry. */
  | { status: 'missed'; reason: string }
  /** The host failed to take it: the only outcome worth an operator's attention. */
  | { status: 'failed'; detail: string }

export interface WakeDeliveryDeps<R extends WakeShape> {
  wake: (request: R) => Promise<WakeAnswer>
  logger: { warn: (entry: Record<string, unknown>) => void }
  /** A detached wake that did not land, told to a person as well as the log. */
  onUndelivered?: (
    request: R,
    subject: string,
    outcome: Exclude<WakeOutcome, { status: 'delivered' }>,
  ) => void
  outbox?: Pick<WakeOutbox<R>, 'record' | 'remove' | 'pending'>
  now?: () => number
}

export function createWakeDelivery<R extends WakeShape>(deps: WakeDeliveryDeps<R>) {
  const now = deps.now ?? Date.now
  const wakeOnce = async (request: R): Promise<WakeOutcome> => {
    try {
      const answer = await deps.wake(request)
      if (answer.delivered) return { status: 'delivered' }
      if (answer.missed && answer.missed !== 'unreadable')
        return { status: 'missed', reason: answer.missed }
      return { status: 'failed', detail: answer.detail ?? answer.missed ?? 'not delivered' }
    } catch (error) {
      return { status: 'failed', detail: errorMessage(error) }
    }
  }
  const outboxed = (request: R) =>
    deps.outbox && request.deliveryKey && !request.receipt ? request.deliveryKey : null
  const deliver = async (request: R): Promise<WakeOutcome> => {
    const key = outboxed(request)
    if (key) {
      // Not recorded is not a reason to drop the wake: it is sent anyway, as before.
      await deps.outbox!.record(request, new Date(now()).toISOString()).catch(() => undefined)
    }
    const outcome = await wakeOnce(request)
    // A failure is the host's (its store); the row stays and the next boot tries again.
    if (key && outcome.status !== 'failed') await deps.outbox!.remove(key).catch(() => undefined)
    return outcome
  }

  return {
    deliver,
    /**
     * Detached delivery. `subject` names what the wake was FOR, which only the producer knows.
     * `settled` hands the producer the outcome too — a standing subscription (a plugin monitor
     * armed for a session) must stop addressing a session that is gone, or every later line
     * would log and notify the same miss again.
     */
    send(request: R, subject: string, settled?: (outcome: WakeOutcome) => void): void {
      void deliver(request).then((outcome) => {
        settled?.(outcome)
        if (outcome.status === 'delivered') return
        deps.logger.warn({
          event: 'wake.undelivered',
          subject,
          sessionId: request.sessionId,
          source: request.source,
          ...(outcome.status === 'missed' ? { missed: outcome.reason } : { err: outcome.detail }),
        })
        deps.onUndelivered?.(request, subject, outcome)
      })
    },
    /**
     * A wake its producer could not address: nothing named a session for it. It is delivered to
     * no one — picking a session would be a guess — and logged under the same event a miss is, so
     * "why did my watcher never wake anything" has one place to be answered.
     */
    unaddressed(subject: string, source: R['source']): void {
      deps.logger.warn({ event: 'wake.undelivered', subject, source, missed: 'no-session' })
    },
    /** Boot: send again what a previous process recorded and never handed over. */
    async redeliver(): Promise<number> {
      if (!deps.outbox) return 0
      const pending = await deps.outbox.pending(now())
      for (const request of pending) {
        const outcome = await deliver(request)
        if (outcome.status === 'delivered') continue
        deps.logger.warn({
          event: 'wake.undelivered',
          subject: 'redelivered wake',
          sessionId: request.sessionId,
          source: request.source,
          ...(outcome.status === 'missed' ? { missed: outcome.reason } : { err: outcome.detail }),
        })
      }
      return pending.length
    },
  }
}

export type WakeDelivery<R extends WakeShape = WakeShape> = ReturnType<typeof createWakeDelivery<R>>

/**
 * The wake one fire asks for. Addressed to the participant that armed the trigger — if it has
 * since left, the host drops the address and the conversation chooses — and keyed by the fire, so
 * a retried fire is the same delivery.
 */
export function triggerWake<S extends string>(
  trigger: Pick<TriggerRecord, 'userId' | 'sessionId' | 'owner'>,
  wake: { content: string; source: S; deliveryKey: string; coalesce?: string },
): WakeShape<S> {
  return {
    userId: trigger.userId,
    sessionId: trigger.sessionId,
    content: wake.content,
    source: wake.source,
    deliveryKey: wake.deliveryKey,
    ...(wake.coalesce ? { coalesce: wake.coalesce } : {}),
    ...(trigger.owner.kind === 'agent' && trigger.owner.agentId
      ? { to: { participant: agentParticipant(trigger.owner.agentId) } }
      : {}),
  }
}

/** A delivery outcome as a fire's outcome: a miss or a failure is the fire failing. */
export function fireOutcomeOf(outcome: WakeOutcome): { ok: boolean; error?: string } {
  if (outcome.status === 'delivered') return { ok: true }
  return {
    ok: false,
    error: outcome.status === 'missed' ? `wake missed: ${outcome.reason}` : outcome.detail,
  }
}
