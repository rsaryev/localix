import type { AssistantMessage, ToolCall, ToolResult, ToolResultMessage } from '..'

import type { AgentMessage } from './types'

const ABORTED_TOOL_RESULT_CONTENT = 'aborted'

function assistantToolCalls(message: AgentMessage): ToolCall[] {
  if (!isAssistantMessage(message)) return []
  return message.content.filter((part): part is ToolCall => part.type === 'tool_call')
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return 'role' in message && message.role === 'assistant'
}

function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
  return 'role' in message && message.role === 'tool'
}

/**
 * Repair tool-call pairing on the transient model history.
 *
 * A process crash can persist a tool call before its result. Provider protocols
 * reject that incomplete pair, so a deterministic error result is inserted
 * immediately after the assistant message that owns the call.
 *
 * `'aborted'` is the ONLY honest repair available from here — this module has no way to ask what
 * became of the call. That makes it the wrong place to land a call whose fate IS knowable: a tool item
 * left `running` on purpose (an async delegate, a background job) used to arrive here and be reported
 * to the model as an errored abort while the sub-agent was alive. `itemsToWireMessages` in `chat.ts`
 * now pairs those with their own ack before they reach this function; a `pending` item still lands
 * here, and for one that never executed `'aborted'` is accurate. Conversely, tool
 * results whose call no longer exists (for example after history surgery) are
 * removed. A retained result's redundant `toolName` is reconciled from that call
 * id so name-requiring provider wires cannot observe stale persistence metadata.
 * Existing messages and results retain their relative order, and the input is
 * never mutated.
 */
export function normalizeToolCallHistory(messages: readonly AgentMessage[]): AgentMessage[] {
  const callIds = new Set<string>()
  const callNames = new Map<string, string>()
  const ambiguousCallNames = new Set<string>()
  const resultIds = new Set<string>()

  for (const message of messages) {
    for (const call of assistantToolCalls(message)) {
      callIds.add(call.id)
      const previousName = callNames.get(call.id)
      if (previousName !== undefined && previousName !== call.name) {
        // Duplicate provider call ids are already malformed history. Do not guess
        // which name owns a result when two different calls claim the same id.
        ambiguousCallNames.add(call.id)
      } else if (previousName === undefined) {
        callNames.set(call.id, call.name)
      }
    }
    if (isToolResultMessage(message)) {
      for (const result of message.results) resultIds.add(result.toolCallId)
    }
  }

  const normalized: AgentMessage[] = []
  for (const message of messages) {
    if (isToolResultMessage(message)) {
      const results = message.results.flatMap((result): ToolResult[] => {
        if (!callIds.has(result.toolCallId)) return []
        const callName = ambiguousCallNames.has(result.toolCallId)
          ? undefined
          : callNames.get(result.toolCallId)
        return callName !== undefined && result.toolName !== callName
          ? [{ ...result, toolName: callName }]
          : [result]
      })
      if (results.length === 0) continue
      normalized.push(
        results.length === message.results.length &&
          results.every((result, index) => result === message.results[index])
          ? message
          : { ...message, results },
      )
      continue
    }

    normalized.push(message)
    if (!isAssistantMessage(message)) continue
    const missingResults = assistantToolCalls(message).flatMap((call): ToolResult[] =>
      resultIds.has(call.id)
        ? []
        : [
            {
              type: 'tool_result',
              toolCallId: call.id,
              toolName: call.name,
              content: ABORTED_TOOL_RESULT_CONTENT,
              isError: true,
            },
          ],
    )
    if (missingResults.length === 0) continue

    normalized.push({
      role: 'tool',
      results: missingResults,
      timestamp: message.timestamp,
    })
  }

  return normalized
}
