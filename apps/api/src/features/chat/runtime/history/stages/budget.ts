/**
 * PREFLIGHT + ADMISSION: refuse honestly what cannot be sent, and notice what needs a
 * checkpoint the provider measurement did not foresee.
 *
 * Two stages over one shared `BudgetScratch`, because the numbers they use are the SAME
 * numbers: the frame, the measured context, whether the provider's anchor still covers the
 * request. Computing them once and reading them twice keeps the layers agreeing.
 *
 *   `preflight`  — the two refusals no checkpoint can fix: the active turn alone exceeds the
 *                  history budget, or the protected first task + active turn do.
 *   `admission`  — the final measured-or-estimated request size against the ceiling. On a turn
 *                  that took no checkpoint, an oversized view is not an error but a checkpoint
 *                  due NOW (`ceiling`): a smaller model, or history with no provider measurement
 *                  yet. On a turn that just took one, it is the real refusal.
 *
 * A provider measurement is authoritative for the prefix it covers. When the anchor still
 * fits, no heuristic may overrule it — re-estimating an already-measured 143k prefix by bytes
 * is what rejected a request that fit.
 */
import { estimateChatMessageTokens } from '@localixai/agent'
import type { HistoryStage } from '@localixai/agent/history'

import type { StoredMessagePayload } from '../../../../../db/payload'
import {
  ActiveTurnTooLargeError,
  LocalContextBudgetExceededError,
  ProtectedHistoryTooLargeError,
  type ContextBudgetFrame,
} from '../../context-budget'
import {
  estimateModelContextTokens,
  type ContextAnchorIdentity,
  type ContextUsageAnchor,
} from '../../context-token-estimate'

/** The per-materialize numbers both budget stages read. */
export interface BudgetScratch {
  frame: ContextBudgetFrame
  /** By id, not index: a checkpoint's projection moves every message after the cut. */
  activeInvocationId?: string
  anchor?: ContextUsageAnchor
  identity?: ContextAnchorIdentity
  /** Did this turn take a checkpoint? Then an oversized view is a refusal, not a trigger. */
  checkpointed: boolean
  /** Filled by `admission`. */
  estimate?: ReturnType<typeof estimateModelContextTokens>
  /** Set by `admission` when the view needs a checkpoint this turn did not plan. */
  overCeiling?: boolean
}

export function preflightStage(scratch: BudgetScratch): HistoryStage<StoredMessagePayload> {
  return {
    name: 'preflight',
    run: (payloads) => {
      const { frame } = scratch
      const activeInvocationIndex = scratch.activeInvocationId
        ? payloads.findIndex((payload) => payload.id === scratch.activeInvocationId)
        : -1
      const budget = frame.historyBudget
      const active = activeInvocationIndex >= 0 ? payloads[activeInvocationIndex] : undefined
      const activeTurnTokens = active ? estimateChatMessageTokens(active) : 0
      if (activeTurnTokens > budget) {
        throw new ActiveTurnTooLargeError({
          frame,
          requiredTokens: activeTurnTokens,
          availableTokens: budget,
          estimateSource: 'heuristic',
          protectedMessageIds: active?.id ? [active.id] : [],
          message:
            `The active user turn and its attached context require approximately ${activeTurnTokens} tokens, ` +
            `but ${budget} tokens are available after the system prompt, tools, and response reserve. ` +
            'Put large source material in a file and ask the agent to read it in chunks, or switch to a model with a larger input capacity.',
        })
      }
      const first = payloads[0]
      const firstMessageTokens = first ? estimateChatMessageTokens(first) : 0
      const protectedHistoryTokens =
        firstMessageTokens + (activeInvocationIndex > 0 ? activeTurnTokens : 0)
      if (protectedHistoryTokens > budget) {
        throw new ProtectedHistoryTooLargeError({
          frame,
          requiredTokens: protectedHistoryTokens,
          availableTokens: budget,
          estimateSource: 'heuristic',
          protectedMessageIds: [
            first?.id,
            activeInvocationIndex > 0 ? active?.id : undefined,
          ].filter((id): id is string => typeof id === 'string'),
          message:
            `The protected first task and active turn require approximately ${protectedHistoryTokens} tokens, ` +
            `but ${budget} tokens are available for message history. ` +
            'Clear the conversation, move large source material to files, or use a model with a larger input capacity.',
        })
      }
      return { messages: payloads }
    },
  }
}

export function admissionStage(scratch: BudgetScratch): HistoryStage<StoredMessagePayload> {
  return {
    name: 'admission',
    run: (payloads) => {
      const { frame } = scratch
      const estimate = estimateModelContextTokens(
        payloads,
        scratch.anchor,
        frame.fixedOverhead,
        scratch.identity,
      )
      scratch.estimate = estimate
      if (estimate.tokens <= frame.trigger) return { messages: payloads }
      if (!scratch.checkpointed) {
        scratch.overCeiling = true
        return { messages: payloads }
      }
      throw new LocalContextBudgetExceededError({
        reason: 'estimated_context_too_large',
        frame,
        requiredTokens: estimate.tokens,
        availableTokens: frame.trigger,
        estimateSource: estimate.source,
        message:
          `Local context policy estimates this request at ${estimate.tokens} tokens, ` +
          `above its ${frame.trigger}-token request budget even after a context checkpoint. ` +
          'Move large material out of the recent turns, or switch to a model with a larger input capacity.',
      })
    },
  }
}
