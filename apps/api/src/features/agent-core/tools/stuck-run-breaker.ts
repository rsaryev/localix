import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { resultFromThrow } from './tool-error-result'

/**
 * THE ONE BRAKE ON A STUCK TOOL LOOP — limits, not advice.
 *
 * A run is stopped when it is provably going nowhere, and for no other reason:
 *
 *  - the same call failed the same way `sameFailure` times in a row;
 *  - `consecutiveFailures` calls failed with no success between, whatever they were;
 *  - the same call was issued `identicalCalls` times in a row, however it ended.
 *
 * Nothing is appended to a result before that. Three wrappers used to coach the model on the
 * way — hint ladders, A-B-A-B cycle detection, "change the approach" notes — and every one of
 * them restated the base prompt. A model is trusted to act on the results it reads; the host
 * only refuses to pay for a loop that cannot end on its own.
 *
 * A tool that declares each call has its own effect (`behaviorHints.idempotentHint: false`, the
 * MCP annotation: a game move, a counter) repeats legitimately, so for it an identical call is the
 * same call that also got the same answer.
 *
 * A user's or the clock's cancellation (`aborted`, `timeout`, `dismissed`) is not a failure of
 * the run and neither counts nor resets. A THROWN error is converted here into the ordinary error
 * result the loop reads, so it is counted like any other.
 *
 * Stopping: `terminate: true` is a normal loop end (the run finalizes `completed`, so a delegated
 * child still reports). The loop ends a batch only when every result terminates, so the stop latches:
 * every later call in the run returns `terminate` without executing.
 */
export const STUCK_RUN_LIMITS = { sameFailure: 4, consecutiveFailures: 6, identicalCalls: 8 }

export type StuckRunLimits = typeof STUCK_RUN_LIMITS

const CANCELLED_KINDS = new Set(['aborted', 'timeout', 'dismissed'])

/** Deterministic JSON, keys sorted at every level, so equal inputs collide whatever their order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`
}

function signatureOf(name: string, input: unknown): string {
  try {
    return `${name}\u0000${canonical(input)}`
  } catch {
    return `${name}\u0000${String(input)}`
  }
}

function contentText(result: AgentToolResult): string {
  return typeof result.content === 'string' ? result.content : canonical(result.content)
}

export function wrapToolsWithStuckRunBreaker(
  tools: readonly AgentTool[],
  limits: StuckRunLimits = STUCK_RUN_LIMITS,
): AgentTool[] {
  let stoppedBecause: string | undefined
  let consecutiveFailures = 0
  let lastCall: { signature: string; count: number } | undefined
  let lastFailure: { signature: string; text: string; count: number } | undefined

  const stop = (result: AgentToolResult, reason: string): AgentToolResult => {
    stoppedBecause = reason
    const note = `[stopped] ${reason} The run was ended.`
    return {
      ...result,
      terminate: true,
      content: typeof result.content === 'string' ? `${result.content}\n\n${note}` : note,
    }
  }

  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, context) {
      if (stoppedBecause) {
        return {
          content: `[stopped] ${stoppedBecause} This call was not executed.`,
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
      // A terminating tool (or an inner stop) ends the run anyway.
      if (result.terminate) return result

      const callSignature = signatureOf(tool.name, input)
      const identity =
        tool.behaviorHints?.idempotentHint === false
          ? `${callSignature}\u0000${contentText(result)}`
          : callSignature
      lastCall =
        lastCall?.signature === identity
          ? { signature: identity, count: lastCall.count + 1 }
          : { signature: identity, count: 1 }

      if (!result.isError) {
        consecutiveFailures = 0
        lastFailure = undefined
      } else if (!CANCELLED_KINDS.has(result.error?.kind ?? '')) {
        consecutiveFailures += 1
        const text = contentText(result)
        lastFailure =
          lastFailure?.signature === callSignature && lastFailure.text === text
            ? { ...lastFailure, count: lastFailure.count + 1 }
            : { signature: callSignature, text, count: 1 }
        if (lastFailure.count >= limits.sameFailure) {
          return stop(
            result,
            `The same \`${tool.name}\` call failed the same way ${lastFailure.count} times in a row.`,
          )
        }
        if (consecutiveFailures >= limits.consecutiveFailures) {
          return stop(
            result,
            `${consecutiveFailures} tool calls failed in a row with no success between.`,
          )
        }
      }
      if (lastCall.count >= limits.identicalCalls) {
        return stop(
          result,
          `The same \`${tool.name}\` call was issued ${lastCall.count} times in a row.`,
        )
      }
      return result
    },
  }))
}
