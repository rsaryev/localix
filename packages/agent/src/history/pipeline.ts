/**
 * The stage engine: run an ordered list of history stages and report what each one did.
 *
 * It generalizes `utils/prune-messages.ts` from per-MESSAGE rules to whole-HISTORY stages —
 * a boundary cut, a media rehydrate, a budget allocation all see the list — and it borrows
 * the safety triad that `agent-core/tools/bash/output-filters` proved on bash output:
 *
 *   1. FAIL-SAFE: an advisory stage that throws is skipped, not fatal.
 *   2. NEVER-WORSE: a stage that claims to shrink and does not is discarded.
 *   3. PROVENANCE: every stage leaves a report, so a wire nobody expected can be traced to
 *      the stage that produced it instead of being re-derived by reading code.
 *
 * The engine is pure: it neither measures time nor writes anything. The estimator arrives in
 * the context so one run's stages, and its per-request transform, all cost a message the
 * same way — two estimators disagreeing by a few tokens is how an admission check starts
 * refusing requests that fit.
 */
import type { StageReport } from './types'
import type { HistoryStage, StageContext } from './stage'

export interface PipelineOptions {
  /**
   * How much a shrinking stage may exceed its input before the result is discarded, as a
   * fraction. Small and non-zero: a stage that rewrites a body may add a few tokens of
   * marker while removing far more, and a hard zero would reject that legitimate case.
   */
  growthAllowance?: number
}

export interface PipelineResult<M> {
  messages: readonly M[]
  reports: StageReport[]
}

const DEFAULT_GROWTH_ALLOWANCE = 0.02

/** Count how many entries changed identity — the stage's own claim, verified. */
function changedCount<M>(before: readonly M[], after: readonly M[]): number {
  if (before.length !== after.length) return Math.max(before.length, after.length)
  let changed = 0
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++
  return changed
}

/**
 * Run `stages` in order. Each stage sees the previous stage's output; a skipped or discarded
 * stage passes its input through unchanged, so the list is always the output of the last
 * stage that actually succeeded.
 */
export async function runHistoryStages<M>(
  messages: readonly M[],
  stages: readonly HistoryStage<M>[],
  ctx: StageContext,
  options: PipelineOptions = {},
): Promise<PipelineResult<M>> {
  const allowance = options.growthAllowance ?? DEFAULT_GROWTH_ALLOWANCE
  const reports: StageReport[] = []
  let current = messages

  for (const stage of stages) {
    ctx.signal.throwIfAborted()
    const tokensBefore = ctx.estimate(current)
    let outcome
    try {
      outcome = await stage.run(current, ctx)
    } catch (error) {
      // A load-bearing stage states a rule; failing to apply it is not a smaller wire, it is
      // a wrong one. Only advisory stages are contained.
      if (!stage.advisory) throw error
      reports.push({
        stage: stage.name,
        status: 'failed',
        changedCount: 0,
        tokensBefore,
        tokensAfter: tokensBefore,
      })
      continue
    }

    const tokensAfter = ctx.estimate(outcome.messages)
    if (stage.shrinksOnly && tokensAfter > tokensBefore * (1 + allowance)) {
      reports.push({
        stage: stage.name,
        status: 'discarded_grew',
        changedCount: 0,
        tokensBefore,
        tokensAfter: tokensBefore,
      })
      continue
    }

    const changed = changedCount(current, outcome.messages)
    reports.push({
      stage: stage.name,
      status: changed === 0 && !outcome.dropped?.length ? 'noop' : 'applied',
      changedCount: changed,
      tokensBefore,
      tokensAfter,
      ...(outcome.dropped?.length ? { dropped: outcome.dropped } : {}),
    })
    current = outcome.messages
  }

  return { messages: current, reports }
}
