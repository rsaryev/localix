import type { AgentTool } from '@localixai/agent/agents'
import { createMistakeTracker, type MistakeTrackerOptions } from '@localixai/agent/agents'

/**
 * Cross-reason consecutive-failure breaker, wired at the tool boundary. The sibling
 * guards key on SAMENESS — `failure-guard` on the identical failing call signature,
 * `repeat-call-reminder` on identical/ABAB signatures — so a
 * model that fails DIFFERENTLY every time (a bad edit, then a doomed bash, then an
 * invalid patch) trips neither and can burn a whole session with zero progress. This
 * wrapper counts classified failures across ALL calls and stops the run once
 * `maxConsecutive` (default 5) accumulate with no success between.
 *
 * Composes as an INDEPENDENT breaker, outermost around the sameness guards:
 *  - it observes results AFTER failure-guard's handling (hints already appended), and
 *    its counters are never merged with failure-guard's — no double-counting, just two
 *    detectors with different keys;
 *  - its threshold (5) is above failure-guard's hard stop (4), so on IDENTICAL repeats
 *    the more specific detector always wins and this one only fires on VARIED failures;
 *  - a result that already carries `terminate` (failure-guard's hard stop, a
 *    terminating tool like sleep/report) passes through unrecorded — the run is ending,
 *    and counting synthetic short-circuit results would distort the breakdown.
 *
 * Reason classification at this seam: `error.kind === 'validation'` means the model
 * supplied invalid tool INPUT (a non-matching patch, a missing required field the tool
 * itself rejected) → 'invalid_tool_call'; every other error → 'tool_execution_failed'.
 * Cancellation kinds (aborted/timeout/dismissed) are the user's or the clock's doing,
 * not the model's mistake — the run event handler classifies them as non-failures for
 * the same reason — so they neither count nor reset.
 *
 * Stop mechanics mirror failure-guard's documented choice: `terminate: true` is a
 * NORMAL loop end, so the run finalizes `completed` with the stop message visible in
 * the last tool result — not `stopped` (which a delegated task run would re-queue without
 * counting an attempt). Pi ends a batch only when ALL results terminate, so a
 * run-scoped latch short-circuits every subsequent call with `terminate` too.
 */

/** User/clock cancellations — not model mistakes; see the header. */
const CANCELLED_KINDS = new Set(['aborted', 'timeout', 'dismissed'])

/** Compact "tool: first line of its error" for the stop message's `last:` slot. */
function failureDetail(toolName: string, content: unknown): string {
  if (typeof content !== 'string') return toolName
  const firstLine = content.trim().split('\n')[0].trim()
  return `${toolName}: ${firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine}`
}

export function wrapToolsWithMistakeBreaker(
  tools: readonly AgentTool[],
  options?: MistakeTrackerOptions,
): AgentTool[] {
  // Run-scoped, like failure-guard's maps: one tracker per assembly, discarded with the run.
  const tracker = createMistakeTracker(options)

  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, context) {
      // Latched stop: pi ends a batch only when ALL results terminate, so once the
      // verdict fired every later call must short-circuit (nothing executes) for the
      // next batch to be all-terminate by construction.
      const before = tracker.check()
      if (before.action === 'stop') {
        return {
          content:
            `[guardrail] The run was already stopped after repeated consecutive failures. ` +
            `This \`${tool.name}\` call was NOT executed. ${before.message}`,
          isError: true,
          terminate: true,
        }
      }

      const result = await tool.execute(toolCallId, input, signal, onUpdate, context)
      // Already ending (inner hard stop / terminating tool) — see the header.
      if (result.terminate) return result
      if (!result.isError) {
        tracker.recordSuccess()
        return result
      }
      const kind = result.error?.kind
      if (kind !== undefined && CANCELLED_KINDS.has(kind)) return result

      tracker.record(
        kind === 'validation' ? 'invalid_tool_call' : 'tool_execution_failed',
        failureDetail(tool.name, result.content),
      )
      const verdict = tracker.check()
      if (verdict.action === 'ok') return result
      if (verdict.action === 'notice') {
        // continue-with-notice mode: recovery guidance rides the failing result; the
        // tracker already reset itself, so the model gets a fresh budget.
        return typeof result.content === 'string'
          ? { ...result, content: `${result.content}\n\n[guardrail] ${verdict.text}` }
          : result
      }
      return {
        ...result,
        terminate: true,
        content:
          typeof result.content === 'string'
            ? `${result.content}\n\n[guardrail] ${verdict.message}`
            : `[guardrail] ${verdict.message}`,
      }
    },
  }))
}
