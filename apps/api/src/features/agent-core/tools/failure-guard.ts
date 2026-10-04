import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { resultFromThrow } from './tool-error-result'

/**
 * Repeat-failure guardrail.
 *
 * Weak models routinely retry the IDENTICAL tool call that just failed — the same
 * `apply_patch` whose context doesn't match, the same `read` of a wrong path, the
 * same doomed `bash`. Each retry is a wasted turn plus a full context replay
 * (measured: 9 such repeat-fail streaks across recent sessions, mostly file edits).
 *
 * This wrapper tracks, per run, how many times each (toolName + serialized input)
 * has returned an error. On the Nth identical failure it APPENDS a one-line hint
 * to the model-facing result steering it to change approach. A success clears that
 * signature's streak so a later genuine retry isn't pre-blamed.
 *
 * Hard stop: when a model ignores the hint and keeps re-issuing the IDENTICAL call,
 * it can spiral for dozens of turns (measured: one session had 28–40-turn thrash
 * runs of edit→typecheck-fail→revert→retry while the hint fired 66×). After
 * `hardStopThreshold` identical failures the wrapper sets `terminate` so the agent
 * loop stops the run after this batch rather than burning more turns + context on a
 * call that is provably stuck. Only the IDENTICAL-call signal hard-stops — the
 * broader no-progress case (different inputs) stays a hint, since varied inputs can
 * be genuine exploration. Everything else is purely additive (never blocks/rewrites).
 *
 * Cross-regime safety: `terminate` is a NORMAL loop end, so a run finalizes as
 * `completed`, NOT `stopped`. For an unattended delegated run that matters: the parent
 * receives a report for a child that thrashed instead of a stop it could mistake for the
 * user's own, and nothing re-runs the child on its behalf.
 *
 * A THROWN tool error is counted here, and ONLY here. A tool that throws never
 * reaches pi as a result: the loop catches it far outside this chain and rebuilds a
 * bare error result from `error.message` alone (cause, code and stack are dropped),
 * so before this every wrapper in the chain saw nothing at all — the guard's counters
 * stayed at zero, the repeat hint never fired, and the hard stop that exists to brake
 * exactly that thrash never armed. `resultFromThrow` (tool-error-result.ts) turns the
 * throw into the ordinary `{ isError: true }` result the chain already understands, at
 * the INNERMOST of the three guards — so the repeat-call reminder and the mistake
 * breaker outside it are handed a result too and need no catch of their own. That is
 * why this wrapper must stay innermost of the three (see run/tool-wrapper-chain.ts).
 *
 * The two HOOK wrappers inside this one convert with the same function, so their post
 * hooks can observe a failed call; when they do, this guard is simply handed a result
 * and its catch does not fire. Counting is unchanged either way — the conversion is
 * idempotent in effect, not repeated.
 *
 * Pi batch contract: the loop ends on a tool batch only when ALL results carry
 * `terminate` (the home-grown loop's ANY-terminate died with it — see
 * agent-runtime-pi/event-codec). One hard-stopped result inside a parallel batch
 * with successful siblings therefore no longer ends the run by itself. The guard
 * compensates with a run-scoped latch: once the hard stop fires, every SUBSEQUENT
 * tool call short-circuits with `terminate: true` (nothing executes), so the next
 * batch is all-terminate by construction and the run ends one turn later at most.
 */

/**
 * Deterministic JSON with keys sorted at EVERY level, so two calls with the same
 * content but different key order collide. Done by recursion rather than passing a
 * key array as JSON.stringify's second arg — that form is an array REPLACER applied
 * recursively, which BLANKS every nested object (`{data:{name:"a"}}` → `{"data":{}}`),
 * collapsing distinct nested-input calls (user_profile/ask/quiz/browser) into
 * one signature and falsely tripping the verbatim-retry hint / hard-stop on
 * genuinely different inputs.
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const obj = v as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`
}

function callSignature(name: string, input: unknown): string {
  let key: string
  try {
    key = stableStringify(input)
  } catch {
    key = String(input)
  }
  return `${name}\u0000${key}`
}

export interface FailureGuardOptions {
  /** Hint once the IDENTICAL call (toolName+input) has failed this many times (default 2). */
  repeatThreshold?: number
  /** Hint once a TOOL has failed this many times with no success between (default 3). */
  noProgressThreshold?: number
  /**
   * Terminate the run once the IDENTICAL call has failed this many times (default 4)
   * — a provably-stuck loop the hint failed to break. Must be > repeatThreshold so
   * the model gets at least one hinted chance to self-correct first.
   */
  hardStopThreshold?: number
}

export function wrapToolsWithFailureGuard(
  tools: readonly AgentTool[],
  options: FailureGuardOptions = {},
): AgentTool[] {
  const repeatThreshold = Math.max(2, options.repeatThreshold ?? 2)
  const noProgressThreshold = Math.max(2, options.noProgressThreshold ?? 3)
  const hardStopThreshold = Math.max(repeatThreshold + 1, options.hardStopThreshold ?? 4)
  // Per identical call (toolName + input) failure count, and per TOOL failure
  // count since that tool last succeeded. Both reset on a success.
  const sigFailures = new Map<string, number>()
  /**
   * What the identical call failed WITH last time. "Stuck" is the same call failing the same way:
   * a call whose outcome depends on state the agent changes in between — `plugin_build` after an
   * edit, a test run after a fix — fails with a different report each time, and that is progress.
   * Counting it as a verbatim repeat told the agent "retrying will fail the same way"
   * while each build reported a shorter to-do list, and would have stopped the run at four.
   */
  const sigLastFailure = new Map<string, string>()
  const toolFailures = new Map<string, number>()
  // Run-scoped hard-stop latch (see the header): armed by the hard stop below so
  // every later call terminates without executing — pi ends a batch only when ALL
  // results terminate, so one flagged result among successful siblings isn't enough.
  let hardStopped = false

  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, context) {
      if (hardStopped) {
        return {
          content:
            '[guardrail] The run was already stopped after a provably-stuck repeated failure. ' +
            `This \`${tool.name}\` call was NOT executed — no further tool calls run this turn. ` +
            'Report what you tried and what a fresh attempt should do differently.',
          isError: true,
          terminate: true,
        }
      }
      let result: AgentToolResult
      try {
        result = await tool.execute(toolCallId, input, signal, onUpdate, context)
      } catch (error) {
        result = resultFromThrow(tool.name, error)
      }
      const sig = callSignature(tool.name, input)

      if (!result.isError) {
        sigFailures.delete(sig)
        sigLastFailure.delete(sig)
        toolFailures.delete(tool.name) // any success means the tool is making progress
        return result
      }

      const failure =
        typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
      const sameFailure = sigLastFailure.get(sig) === failure
      sigLastFailure.set(sig, failure)
      const sigCount = (sameFailure ? (sigFailures.get(sig) ?? 0) : 0) + 1
      sigFailures.set(sig, sigCount)
      const toolCount = (toolFailures.get(tool.name) ?? 0) + 1
      toolFailures.set(tool.name, toolCount)
      if (typeof result.content !== 'string') return result

      // Most specific + most severe: the model has re-issued the IDENTICAL failing
      // call enough times that hinting has demonstrably not worked — stop the run.
      if (sigCount >= hardStopThreshold) {
        hardStopped = true
        return {
          ...result,
          terminate: true,
          content:
            `${result.content}\n\n[guardrail] This exact \`${tool.name}\` call has now failed ${sigCount}× in a row ` +
            `despite earlier hints — the run is stuck and is being stopped to avoid burning more turns. ` +
            `Report what you tried, the root cause you suspect, and what a fresh attempt should do differently.`,
        }
      }
      // Next: the model re-issued the IDENTICAL failing call — hint to change tack.
      if (sigCount >= repeatThreshold) {
        return {
          ...result,
          content:
            `${result.content}\n\n[guardrail] This exact \`${tool.name}\` call has now failed ${sigCount}× in a row — ` +
            `retrying it verbatim will fail the same way. Change the approach: fix the root cause ` +
            `(e.g. re-read the file so an \`apply_patch\` context matches, correct the path, or adjust the command), ` +
            `or use a different tool. Do NOT re-issue the identical call.`,
        }
      }
      // Broader: the tool keeps failing (different inputs) with no success — a
      // shared root cause (wrong cwd/file, missing dep) the per-call retries miss.
      if (toolCount >= noProgressThreshold) {
        return {
          ...result,
          content:
            `${result.content}\n\n[guardrail] \`${tool.name}\` has now failed ${toolCount}× this run without a single ` +
            `success — the attempts likely share one root cause (wrong directory, a file that isn't where you think, ` +
            `a missing prerequisite). Stop and diagnose that root cause before the next \`${tool.name}\` call.`,
        }
      }
      return result
    },
  }))
}
