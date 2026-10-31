/**
 * Decisions, composed: the one way any part of Localix asks a decision model a typed question.
 *
 * The first backend that can answer for the user answers (`models.ts` lists them; today Jev,
 * wherever a live OpenRouter connection serves it). No consumer names a model, so changing it
 * rewrites no consumer. Around every call this owns what each consumer used to repeat: the
 * resolution, the deadline (resolution included), cancellation, the spend in the usage ledger, and
 * one log record without the state. It never throws: a caller always gets an outcome and keeps its
 * own fallback.
 *
 * Consumers: games, the browser goal check and mini apps (`host.decisions`).
 */
import type { DecisionResult } from '@localixai/agent/runtime'
import {
  DECISION_DEFAULT_DEADLINE_MS,
  DECISION_MAX_DEADLINE_MS,
  type DecisionAsk,
  type DecisionHost,
  type DecisionOptions,
  type DecisionOutcome,
} from '@localixai/mini-app-sdk/backend'
import type { DecisionBackend } from './models'

export interface DecisionRecord {
  purpose: string
  sessionId: string
  status: DecisionOutcome['status']
  model?: string
  ms: number
  /** The question keys asked — never the state. */
  questions: string[]
}

export interface DecisionServiceDeps {
  /** The decision models, preferred first (`models.ts`, composed in `bootstrap/decisions.ts`). */
  backends: readonly DecisionBackend[]
  recordUsage(entry: {
    userId: string
    sessionId: string
    model: string
    providerConnectionId: string | null
    providerId: string
    /** The ledger row a decision's spend lands in. */
    kind: 'decision'
    usage: DecisionResult['usage']
  }): void
  log?(record: DecisionRecord): void
  /** Test seam. */
  now?: () => number
}

export interface DecisionService extends DecisionHost {
  decide(userId: string, ask: DecisionAsk, options: DecisionOptions): Promise<DecisionOutcome>
}

const clampDeadline = (ms: number | undefined) =>
  Math.min(Math.max(ms ?? DECISION_DEFAULT_DEADLINE_MS, 0), DECISION_MAX_DEADLINE_MS)

export function createDecisionService(deps: DecisionServiceDeps): DecisionService {
  const now = deps.now ?? Date.now

  /** The first backend that can answer for this user now; a backend that throws cannot. */
  async function firstDecider(userId: string) {
    for (const backend of deps.backends) {
      const decider = await backend.resolve(userId).catch(() => null)
      if (decider) return { model: backend.model, decider }
    }
    return null
  }

  return {
    async available(userId) {
      const first = await firstDecider(userId)
      return first ? { model: first.model } : null
    },

    async decide(userId, ask, options) {
      const startedAt = now()
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      let answering: string | undefined
      const finish = (outcome: DecisionOutcome): DecisionOutcome => {
        deps.log?.({
          purpose: options.purpose,
          sessionId: options.sessionId,
          status: outcome.status,
          ...(outcome.model ? { model: outcome.model } : {}),
          ms: outcome.ms,
          questions: Object.keys(ask.questions),
        })
        return outcome
      }
      const ended = (status: 'deadline' | 'cancelled' | 'failed' | 'unavailable') => ({
        status,
        ...(answering ? { model: answering } : {}),
        ms: now() - startedAt,
      })
      if (options.signal?.aborted) return finish(ended('cancelled'))

      const onAbort = () => controller.abort()
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const late = new Promise<'deadline'>((done) => {
        timer = setTimeout(() => done('deadline'), clampDeadline(options.deadlineMs))
      })
      const cancelled = new Promise<'cancelled'>((done) =>
        controller.signal.addEventListener('abort', () => done('cancelled'), { once: true }),
      )
      const call = (async () => {
        const first = await firstDecider(userId)
        if (!first) return 'unavailable' as const
        const { model, decider } = first
        answering = model
        const result = await decider.decide({ ...ask, signal: controller.signal })
        // Spend is real whether or not the caller still waits for it.
        deps.recordUsage({
          userId,
          sessionId: options.sessionId,
          model,
          providerConnectionId: decider.providerConnectionId,
          providerId: decider.providerId,
          kind: 'decision',
          usage: result.usage,
        })
        return { model, answers: result.answers }
      })()
      call.catch(() => {})

      try {
        const settled = await Promise.race([call, late, cancelled])
        if (typeof settled === 'string') {
          if (settled !== 'unavailable') controller.abort()
          return finish(ended(settled))
        }
        return finish({
          status: 'answered',
          model: settled.model,
          ms: now() - startedAt,
          answers: settled.answers,
        })
      } catch (error) {
        console.warn(`[decisions] ${options.purpose} failed`, error)
        return finish(ended(controller.signal.aborted ? 'cancelled' : 'failed'))
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}
