/**
 * EXACTLY ONE WAKE WHEN A PROCESS ENDS — a background job the agent asked to hear from
 * (`bash notify`), or a CC `asyncRewake` hook that exits 2.
 *
 * Both used to wake straight from the run's closure when the process exited. That delivered at
 * most once only by accident — nothing named the delivery, so a repeated exit report was a second
 * turn — and a restart lost it outright: the process died with the server, nothing ever reported
 * its exit, and the agent that was told "you will be woken" waited for a turn that never came.
 *
 * So a notice is a `process-exit` trigger, armed when the process STARTS:
 *
 *   fire      the exit, delivered once under `trg:<id>:1` — a repeat is the same delivery — and
 *             the trigger ends with it;
 *   dismiss   an exit nobody should hear about (a stop the caller made, a hook that passed).
 *
 * A restart ends the trigger silently: the process died with the server, its job is listed as
 * lost, and nobody is woken to be told so.
 */
import type { TriggerAction } from '../../triggers/contracts'
import type { TriggerEngine } from '../../triggers/engine'
import {
  fireOutcomeOf,
  triggerWake,
  type WakeOutcome,
  type WakeShape,
} from '../../triggers/delivery'
import type { WakeSource } from '../contracts'

export const EXIT_NOTICE_ACTION = 'exit-notice'

export type ExitNoticeSource = Extract<WakeSource, 'bg-job' | 'hook'>

/** One armed notice: the process it was armed for ends exactly one of these two ways. */
export interface ExitNotice {
  fire(content: string): void
  dismiss(reason: string): void
}

/** The host port a run arms notices through. Null from `arm` means none could be armed. */
export interface ExitNotices {
  arm(input: {
    userId: string
    sessionId: string
    /** The participant whose run started the process — the one the notice is for. */
    agentId: string
    source: ExitNoticeSource
  }): Promise<ExitNotice | null>
}

const sourceOf = (payload: Record<string, unknown>): ExitNoticeSource =>
  payload.source === 'hook' ? 'hook' : 'bg-job'

export function createExitNoticeAction(
  deliver: (request: WakeShape<ExitNoticeSource>) => Promise<WakeOutcome>,
): TriggerAction {
  return {
    id: EXIT_NOTICE_ACTION,
    async fire(trigger, { deliveryKey, event }) {
      const content = typeof event?.content === 'string' ? event.content : ''
      const source = sourceOf(trigger.payload)
      const outcome = await deliver(triggerWake(trigger, { content, source, deliveryKey }))
      return { ...fireOutcomeOf(outcome), end: 'exited' }
    },
  }
}

/** The port, over the engine the action is registered in. */
export function createExitNotices(
  engine: Pick<TriggerEngine, 'arm' | 'emit' | 'end'>,
  logger: { warn: (msg: string) => void },
): ExitNotices {
  const report = (refused: string | null) => {
    if (refused) logger.warn(refused)
  }
  return {
    async arm({ userId, sessionId, agentId, source }) {
      const armed = await engine
        .arm({
          userId,
          sessionId,
          owner: { kind: 'agent', agentId },
          action: EXIT_NOTICE_ACTION,
          kind: 'process-exit',
          spec: {},
          payload: { source },
        })
        .catch((error: unknown) => ({ error: String(error) }))
      if ('error' in armed) {
        logger.warn(`exit notice not armed: ${armed.error}`)
        return null
      }
      return {
        fire: (content) => void engine.emit(armed.id, { content }).then(report),
        dismiss: (reason) =>
          void engine
            .end(armed.id, reason)
            .then((ended) => report('error' in ended ? ended.error : null)),
      }
    },
  }
}
