import { classifyToolCall, type AgentTool, type AgentToolResult } from '@localixai/agent/agents'

import { signatureOf } from './stuck-run-breaker'
import { resultFromThrow } from './tool-error-result'

/**
 * WRITES WHOSE OUTCOME IS UNKNOWN, within one run.
 *
 * A call with an external (or irreversible) effect that failed in a way that may have reached the
 * outside — a dropped connection, a timeout, an abort mid-call — may still have happened. The
 * model repeating it blindly sends the message twice or charges the card twice. This ledger
 * remembers such calls (same tool, canonical arguments) so the permission gate can ask the person
 * before an identical repeat (`permission-gate.ts`), and it tells the model, in the failed result,
 * to check the state first.
 *
 * Not remembered: a validation error or a refusal (nothing was sent), a tool that declares
 * `idempotentHint: true` (a repeat is safe by its own word), a read, and a failure that names no
 * transport trouble (an ordinary error the tool understood). A later success of the same call
 * clears it.
 */
export interface UncertainWrites {
  /** Record this run's failed writes, by the input the tool is called with. */
  wrap(tools: readonly AgentTool[]): AgentTool[]
  /**
   * Run one call and record it: for a layer that sees the very input the permission gate checks
   * (a hook may have rewritten it), so the record and the check use the same key. A throw that
   * is not recorded is rethrown unchanged.
   */
  guard(
    tool: AgentTool,
    input: unknown,
    run: () => Promise<AgentToolResult>,
  ): Promise<AgentToolResult>
  /** An identical earlier call failed and may have taken effect. */
  has(toolName: string, input: unknown): boolean
}

/** Kinds that may have gone out before they failed. `validation`/`blocked` never did. */
const MAYBE_SENT_KINDS = new Set(['timeout', 'aborted', 'provider'])
const TRANSPORT_CODE =
  /^(?:ECONNRESET|ETIMEDOUT|EPIPE|ECONNABORTED|UND_ERR\w*)$|socket hang up|fetch failed|connection (?:closed|lost|reset)/i

/**
 * Only the STRUCTURED error decides: the kind a tool runtime stamped, or the code/message of an
 * error a tool threw. Free-form output is never scanned (a failing build that prints "timed out"
 * ran to an exit code; its outcome is known), and a card nobody answered changed nothing.
 */
function mayHaveReachedOutside(result: AgentToolResult): boolean {
  if (!result.isError) return false
  const error = result.error
  if (!error || error.refusal === 'human') return false
  if (MAYBE_SENT_KINDS.has(error.kind)) return true
  if (error.kind !== 'execution') return false
  return TRANSPORT_CODE.test(String(error.code ?? '')) || TRANSPORT_CODE.test(error.message)
}

export const UNCERTAIN_WRITE_NOTE = (toolName: string): string =>
  `[This \`${toolName}\` call failed in a way that may have reached the outside, so the action ` +
  'may already have taken effect. Check the current state before retrying it.]'

export function createUncertainWrites(): UncertainWrites {
  const unknown = new Set<string>()

  const guard: UncertainWrites['guard'] = async (tool, input, run) => {
    let result: AgentToolResult
    let thrown: { error: unknown } | undefined
    try {
      result = await run()
    } catch (error) {
      thrown = { error }
      result = resultFromThrow(tool.name, error)
    }
    const signature = signatureOf(tool.name, input)
    if (!result.isError) {
      unknown.delete(signature)
      return result
    }
    const { effect, irreversible } = classifyToolCall(tool, input)
    const writes = effect === 'external' || irreversible === true
    if (!writes || tool.behaviorHints?.idempotentHint === true || !mayHaveReachedOutside(result)) {
      if (thrown) throw thrown.error
      return result
    }
    unknown.add(signature)
    const note = UNCERTAIN_WRITE_NOTE(tool.name)
    return {
      ...result,
      content: typeof result.content === 'string' ? `${result.content}\n\n${note}` : note,
    }
  }

  const wrap = (tool: AgentTool): AgentTool => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, context) {
      try {
        return await guard(tool, input, () =>
          tool.execute(toolCallId, input, signal, onUpdate, context),
        )
      } catch (error) {
        return resultFromThrow(tool.name, error)
      }
    },
  })

  return {
    wrap: (tools) => tools.map(wrap),
    guard,
    has: (toolName, input) => unknown.has(signatureOf(toolName, input)),
  }
}
