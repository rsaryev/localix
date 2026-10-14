import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { MAX_BACKGROUND_JOBS_PER_SESSION } from './bash/bash-promote'

/**
 * A call that outruns its budget moves to the BACKGROUND instead of failing.
 *
 * The bash tool already does this for a process: at the deadline the child is detached rather
 * than killed, adopted by a job, and the model gets "still running, here is the job id". This
 * gives the same treatment to work with no process behind it — a plugin tool with no timeout
 * of its own, an MCP call whose server keeps resetting the clock with progress notifications,
 * a long research sweep. Before it, the only escape from those was the user pressing Stop.
 *
 * The body is never abandoned, and that is the whole design. `Promise.race` over
 * `tool.execute` would report a timeout while the work continued and then throw its result
 * away — the tool's promise is the ONLY handle on that result. So the in-flight promise is
 * handed to a detached settler which delivers through the background-job channel when it
 * lands, exactly as a real background job delivers.
 *
 * Opt-in per tool, via `promoteAfterMs`. Promotion only makes sense where "keep going and
 * tell me later" is truthful about the work: it is meaningless for a file read and wrong for
 * a tool whose entire result is what the model is waiting on.
 *
 * Where it sits in the wrapper chain is not free either. It must be INSIDE the failure guard,
 * the repeat-call reminder and the mistake breaker: a promotion is a non-error handoff, and
 * outside them those guards would instead see the timeout as a failure and count it toward a
 * hard stop, while a call they short-circuited would get a phantom job for work that never
 * ran. And it must be OUTSIDE the hook wrappers, so a call a PreToolUse hook denies is never
 * given a clock.
 */

export interface TimeoutPromoterOptions {
  /** Override the per-tool budget (tests; a deployment-wide clamp later). */
  budgetMsFor?: (tool: AgentTool) => number | undefined
}

/**
 * The result a promoted call returns immediately. Not an error: the work is proceeding, and
 * calling it a failure would send the model down a retry path for something that is running.
 */
function promotedResult(input: {
  toolName: string
  jobId: string
  budgetMs: number
  label: string
}): AgentToolResult {
  const seconds = Math.round(input.budgetMs / 1000)
  return {
    content:
      `No result from \`${input.toolName}\` after ${seconds}s — it is still running in the ` +
      `background (job_id: ${input.jobId}): ${input.label}\n` +
      `[its result returns automatically next turn; \`jobs\` action="list"/"stop" with ` +
      `job_id="${input.jobId}"]`,
  }
}

export function wrapToolsWithTimeoutPromoter(
  tools: readonly AgentTool[],
  options: TimeoutPromoterOptions = {},
): AgentTool[] {
  return tools.map((tool) => {
    const budgetMs = options.budgetMsFor?.(tool) ?? tool.promoteAfterMs
    if (!budgetMs || budgetMs <= 0) return tool
    return {
      ...tool,
      async execute(toolCallId, input, signal, onUpdate, context) {
        const registry = context?.asyncRegistry
        // Our own controller, chained to the run's: a promoted job needs to be stoppable on
        // its own, without taking away the run's ability to cancel everything. A tool that
        // honours cancellation therefore actually stops; one that ignores its signal does
        // not, which is why `jobs action="stop"` reports a stop as REQUESTED, not confirmed.
        const controller = new AbortController()
        if (signal?.aborted) controller.abort()
        else signal?.addEventListener('abort', () => controller.abort(), { once: true })
        const inflight = tool.execute(toolCallId, input, controller.signal, onUpdate, context)
        // No registry means nothing can carry a job — a non-hosted context, or a tool run
        // outside a session. Waiting is then the only honest option.
        if (!registry) return inflight

        const settled = await raceBudget(inflight, budgetMs)
        if (settled !== PENDING) return settled

        // At capacity, promotion would trade a bounded wait for an unbounded pile of jobs.
        // Keep waiting instead and say so: the alternative is silently exceeding a limit the
        // host set on purpose.
        const running = registry.countBackgroundJobs?.() ?? 0
        if (running >= MAX_BACKGROUND_JOBS_PER_SESSION) return inflight

        const label = `${tool.label ?? tool.name} (promoted after ${Math.round(budgetMs / 1000)}s)`
        const dispose = registry.registerActions(
          toolCallId,
          {
            // A stop is REQUESTED, not confirmed — the `jobs` tool says so, and for a tool
            // that ignores its signal that is the only truthful wording.
            kill: { label: 'Stop', icon: 'square', execute: () => controller.abort() },
          },
          { label, kind: 'promoted' },
        )
        const jobId = registry.getBackgroundJobId?.(toolCallId) ?? toolCallId

        // The body keeps its own promise. This settler is the only thing that abandons —
        // and it abandons WAITING, never the result.
        void (async () => {
          try {
            const result = await inflight
            registry.emitBackground(toolCallId, result.content, {
              done: true,
              jobStatus: result.isError ? 'failed' : 'completed',
              notify: true,
            })
          } catch (error) {
            registry.emitBackground(
              toolCallId,
              error instanceof Error ? error.message : String(error),
              { done: true, jobStatus: 'failed', notify: true },
            )
          } finally {
            dispose()
          }
        })()

        return promotedResult({ toolName: tool.name, jobId, budgetMs, label })
      },
    }
  })
}

const PENDING = Symbol('still-running')

/**
 * Resolve with the call's result if it lands inside the budget, or `PENDING` if it does not.
 * The promise is NOT abandoned on the pending path — the caller keeps it.
 */
async function raceBudget(
  inflight: Promise<AgentToolResult>,
  budgetMs: number,
): Promise<AgentToolResult | typeof PENDING> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      inflight,
      new Promise<typeof PENDING>((resolve) => {
        timer = setTimeout(() => resolve(PENDING), budgetMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
