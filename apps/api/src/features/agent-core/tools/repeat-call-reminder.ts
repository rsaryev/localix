import type { AgentTool } from '@localixai/agent/agents'

import { TOOL } from '../tool-names'

/**
 * Repeat-call reminder.
 *
 * The failure guard next door only sees ERROR results — a success clears every streak.
 * That leaves two real loops invisible: a model re-issuing the IDENTICAL call that keeps
 * SUCCEEDING (re-reading the same file, re-running the same passing grep, hammering a
 * refused call whose failure comes back as a plain result), and the period-2 thrash of
 * edit→test→revert→test where every individual call looks healthy.
 *
 * This wrapper tracks, per run, the sequence of call signatures (toolName + canonical
 * input) REGARDLESS of success/error. Two detectors run over it:
 *
 * - IDENTICAL repeats: a counter that grows on each consecutive identical signature and
 *   resets on any different call. Thresholds escalate: generic one-line hint → detailed
 *   hint naming the tool, the count, and a preview of the args → hard stop.
 * - A-B-A-B cycles: a 4-slot ring buffer of the latest signatures; the period-2 pattern
 *   holds when [0]==[2] && [1]==[3] && [0]!=[1] (so plain AAAA never double-fires — it is
 *   the identical detector's case). A full cycle is one A-B pair: the first full window
 *   is 2 cycles, and each further matching call adds half a cycle. Hint at 2 cycles,
 *   hard stop at 4.
 *
 * Bookkeeping tools are TRANSPARENT: a `memory`/`agents`/`jobs` call between two
 * identical `search` calls neither counts as a chain member nor resets it — models
 * legitimately interleave planning-state upkeep with real work, and letting it launder
 * a loop would defeat the detector (`grep X → memory → grep X` is still two consecutive
 * identical greps).
 *
 * A tool that declares each call has its OWN effect (`behaviorHints.idempotentHint: false`, the
 * MCP annotation) is the exception to "the call, not its outcome": a 2048 board takes the same
 * `moves` list turn after turn and answers with a new board each time, and keying on the call
 * alone told the model at the third batch that "repeating it will not produce new information"
 * and stopped the game at the eighth. For such a tool the signature carries the RESULT too, so a
 * repeat is a call that also got the same answer — the board that did not move, the refusal that
 * came back word for word. Every tool that does not declare it (bash, read, edit…) is keyed as
 * before, because a result with a timestamp in it must not launder a loop.
 *
 * A call the TOOL refuses counts: an error result is still a chain member, so a model
 * hammering something that keeps failing is the loop this breaks. A call the PERMISSION GATE
 * refuses does NOT reach here at all — the loop turns a blocked call into a result without
 * running the tool, so no wrapper sees it. That class is counted by the gate's own breaker
 * (permission-gate-breaker.ts); the two are independent on purpose.
 *
 * Hard stop reuses the failure guard's mechanism verbatim: `terminate: true` is a NORMAL
 * loop end (run finalizes `completed`, not `stopped` — see failure-guard.ts for why that
 * matters to a delegated run's report), and because pi ends a tool batch only when ALL
 * results terminate, a run-scoped latch makes every SUBSEQUENT call short-circuit with
 * `terminate: true` so the next batch is all-terminate by construction.
 *
 * State lives in the wrapper closure — one instance per run (tool-assembly builds the
 * chain per run), nothing persisted.
 */

/**
 * Deterministic JSON with keys sorted at EVERY level, so two calls with the same content
 * but different key order collide. Same recursion as failure-guard's (not exported there;
 * duplicated to keep both guards leaf-independent) — NOT JSON.stringify's array-replacer
 * form, which blanks nested objects and collapses distinct inputs into one signature.
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

function canonicalArgs(input: unknown): string {
  try {
    return stableStringify(input)
  } catch {
    return String(input)
  }
}

function callSignature(name: string, canonicalInput: string): string {
  return `${name}\u0000${canonicalInput}`
}

/** Head-truncate for DISPLAY only — detection always compares the full canonical string. */
function previewArgs(canonicalInput: string, max = 500): string {
  return canonicalInput.length <= max ? canonicalInput : `${canonicalInput.slice(0, max)}…`
}

export interface RepeatCallReminderOptions {
  /**
   * Escalation ladder for consecutive IDENTICAL calls (default [3, 5, 8]):
   * generic hint, detailed hint, hard stop. Kept as a tuple so the relationship
   * between the three is visible at the call site.
   */
  identicalThresholds?: readonly [hint: number, detail: number, hardStop: number]
  /** A-B-A-B: hint at this many full cycles (default 2). */
  cycleHintThreshold?: number
  /** A-B-A-B: terminate the run at this many full cycles (default 4). */
  cycleHardStopThreshold?: number
  /**
   * Tool names whose calls are transparent to the detectors (neither count nor reset).
   * Default: the bookkeeping/planning tools a model legitimately interleaves with work.
   */
  excludeTools?: readonly string[]
}

const DEFAULT_EXCLUDED: readonly string[] = [TOOL.memory, TOOL.agents, TOOL.jobs]

export function wrapToolsWithRepeatCallReminder(
  tools: readonly AgentTool[],
  options: RepeatCallReminderOptions = {},
): AgentTool[] {
  const [hintAt, detailAt, hardStopAt] = options.identicalThresholds ?? [3, 5, 8]
  const cycleHintAt = options.cycleHintThreshold ?? 2
  const cycleHardStopAt = options.cycleHardStopThreshold ?? 4
  const excluded = new Set(options.excludeTools ?? DEFAULT_EXCLUDED)

  // Ring buffer of the last 4 non-excluded signatures, newest LAST. Small enough
  // that shift/push beats an index-juggling ring for clarity at identical cost.
  const recent: string[] = []
  // Consecutive identical-signature count (the current head of `recent`).
  let identicalCount = 0
  // Consecutive calls consistent with the period-2 pattern, counted from the first
  // FULL matching window. Full cycles = 2 + floor((matches - 1) / 2): the first
  // matching window IS two A-B pairs, then each further matching call adds half a pair.
  let cycleMatches = 0
  // Run-scoped hard-stop latch (same contract as failure-guard's): pi ends a batch
  // only when ALL results terminate, so once armed every later call — excluded
  // bookkeeping tools included — terminates without executing.
  let hardStopped = false

  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, context) {
      if (hardStopped) {
        return {
          content:
            '[guardrail] The run was already stopped after a provably-stuck repeated call loop. ' +
            `This \`${tool.name}\` call was NOT executed — no further tool calls run this turn. ` +
            'Report what you tried and what a fresh attempt should do differently.',
          isError: true,
          terminate: true,
        }
      }
      const result = await tool.execute(toolCallId, input, signal, onUpdate, context)
      // Transparent bookkeeping call: neither counts nor resets either chain.
      if (excluded.has(tool.name)) return result

      const canonical = canonicalArgs(input)
      const sig =
        tool.behaviorHints?.idempotentHint === false
          ? `${callSignature(tool.name, canonical)}\u0000${canonicalArgs(result.content)}`
          : callSignature(tool.name, canonical)

      // Identical-repeat chain: success and error alike — the loop is the CALL
      // repeating, not its outcome.
      identicalCount =
        recent.length > 0 && recent[recent.length - 1] === sig ? identicalCount + 1 : 1

      recent.push(sig)
      if (recent.length > 4) recent.shift()

      // Period-2 cycle chain: only meaningful with a full window, and [0]!=[1]
      // keeps plain identical runs out of this detector.
      const windowMatches =
        recent.length === 4 &&
        recent[0] === recent[2] &&
        recent[1] === recent[3] &&
        recent[0] !== recent[1]
      cycleMatches = windowMatches ? cycleMatches + 1 : 0
      const fullCycles = cycleMatches > 0 ? 2 + Math.floor((cycleMatches - 1) / 2) : 0

      if (typeof result.content !== 'string') return result

      // Most severe first: hinting has demonstrably not worked — stop the run.
      if (identicalCount >= hardStopAt) {
        hardStopped = true
        return {
          ...result,
          terminate: true,
          content:
            `${result.content}\n\n[guardrail] This exact \`${tool.name}\` call has now been issued ${identicalCount}× in a row ` +
            `despite earlier hints — the run is looping and is being stopped to avoid burning more turns. ` +
            `Report what you tried, why the repeats did not move the task forward, and what a fresh attempt should do differently.`,
        }
      }
      if (fullCycles >= cycleHardStopAt) {
        hardStopped = true
        return {
          ...result,
          terminate: true,
          content:
            `${result.content}\n\n[guardrail] The last calls have alternated between the same two tool calls for ` +
            `${fullCycles} full cycles despite an earlier hint — the run is thrashing and is being stopped. ` +
            `Report what the two alternating steps were and why neither converged.`,
        }
      }
      // Detailed identical-repeat hint: name the tool, the count, and the args.
      if (identicalCount >= detailAt) {
        return {
          ...result,
          content:
            `${result.content}\n\n[guardrail] You have issued this exact \`${tool.name}\` call ${identicalCount}× in a row ` +
            `with args ${previewArgs(canonical)} — the result will not change. If you already have what you need, ` +
            `act on it; otherwise change the input or the tool. Do NOT re-issue the identical call.`,
        }
      }
      // Generic one-liner: cheap nudge before naming names.
      if (identicalCount >= hintAt) {
        return {
          ...result,
          content: `${result.content}\n\n[guardrail] This is the same tool call repeated ${identicalCount}× in a row — repeating it again will not produce new information.`,
        }
      }
      if (fullCycles >= cycleHintAt) {
        return {
          ...result,
          content:
            `${result.content}\n\n[guardrail] The last calls alternate between the same two tool calls (A→B→A→B, ${fullCycles} full cycles) — ` +
            `this back-and-forth is not converging. Step back, state what each step was supposed to achieve, and change the approach.`,
        }
      }
      return result
    },
  }))
}
