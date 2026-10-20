import {
  runToolCall,
  type AgentTool as PiAgentTool,
  type RunToolCallOptions,
} from '@earendil-works/pi-agent-core'
import type { AssistantMessage as PiAssistantMessage, JsonObject } from '@earendil-works/pi-ai'

import type {
  AgentToolExecutionContext,
  AgentToolResult,
  NestedToolCallOutcome,
} from '@localixai/agent/agents'

type CallTool = NonNullable<AgentToolExecutionContext['callTool']>

/**
 * Tool calls a tool makes on its own behalf (`AgentToolExecutionContext.callTool`), for one run —
 * pi's `createNestedToolRunner` (`vendor/pi/packages/agent/examples/mcp-codemode/tools.ts`) on this
 * run's hooks.
 *
 * Each call goes through pi's `runToolCall` with the run's tools and its `beforeToolCall` /
 * `afterToolCall`, so argument validation, the permission gate and every hook apply as for a call
 * the model makes. The agent loop releases a call's gate decision on `tool_execution_end`; a nested
 * call emits no events, so it is released here once it lands.
 *
 * A nested call's id is its parent's plus a sequence number (`call_1/3`): unique in the run, and
 * readable back to the call that made it.
 */
export function createNestedToolCalls(options: {
  /** The run's dispatch tools, the same list the agent loop executes. */
  tools: () => readonly PiAgentTool[]
  hooks: Pick<RunToolCallOptions, 'beforeToolCall' | 'afterToolCall'>
  /** Where the bridge records each call's host-side result (sanitised, with its details). */
  completedTools: Map<string, AgentToolResult>
  /** The assistant message whose tool call is running: the issuer the hooks are shown. */
  issuer: () => PiAssistantMessage | undefined
  settled: (toolCallId: string) => void
  signal: AbortSignal
}): (parentToolCallId: string) => CallTool {
  const sequence = new Map<string, number>()

  return (parentToolCallId) => async (name, input, signal) => {
    const n = (sequence.get(parentToolCallId) ?? 0) + 1
    sequence.set(parentToolCallId, n)
    const id = `${parentToolCallId}/${n}`
    const issuer = options.issuer()
    if (!issuer) return failed(`Tool ${name} cannot run outside a model turn.`)
    const tools = options.tools()
    try {
      const outcome = await runToolCall(
        { type: 'toolCall', id, name, arguments: (input ?? {}) as JsonObject },
        {
          tools,
          assistantMessage: issuer,
          context: { messages: [], tools: [...tools] },
          ...options.hooks,
          signal: signal ? AbortSignal.any([options.signal, signal]) : options.signal,
        },
      )
      // The bridge's record carries what the host decided the result is (sanitised, with details);
      // pi's own result stands only for a call that never reached the bridge — unknown, invalid,
      // or refused by the gate.
      const result = options.completedTools.get(id) ?? { content: piText(outcome.result.content) }
      return { result, isError: outcome.isError }
    } finally {
      options.completedTools.delete(id)
      options.settled(id)
    }
  }
}

function failed(text: string): NestedToolCallOutcome {
  return { result: { content: text }, isError: true }
}

function piText(content: readonly { type: string; text?: string }[]): string {
  return content
    .flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
    .join('\n')
}
