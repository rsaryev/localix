import type { AssistantMessage, Message, ToolResultMessage } from '@localixai/agent'
import { normalizeToolCallHistory, type AgentMessage } from '@localixai/agent/agents'

import type { SettledCall } from './tools/schedule'
import type { ToolCallRequest } from './tools/call'

/** The conversation as a model reads it: only its own roles, tool calls and results paired. */
export function modelMessages(messages: readonly AgentMessage[]): Message[] {
  return normalizeToolCallHistory(messages).filter(isConversational)
}

/** User, assistant and tool messages — the roles that belong to a conversation with a model. */
export function isConversational(message: AgentMessage): message is Message {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'tool'
}

export function toolCallsOf(message: AssistantMessage): ToolCallRequest[] {
  return message.content.flatMap((part) =>
    part.type === 'tool_call' ? [{ id: part.id, name: part.name, arguments: part.arguments }] : [],
  )
}

/** One call's result as the message the model reads on its next request. */
export function toolResultMessage({ call, outcome }: SettledCall): ToolResultMessage {
  const { result } = outcome
  return {
    role: 'tool',
    results: [
      {
        type: 'tool_result',
        toolCallId: call.id,
        toolName: call.name,
        content: result.contentParts ?? result.content,
        ...(result.isError ? { isError: true } : {}),
        ...(result.details !== undefined ? { details: result.details } : {}),
        ...(result.supersedeKey ? { supersedeKey: result.supersedeKey } : {}),
      },
    ],
    timestamp: Date.now(),
  }
}
