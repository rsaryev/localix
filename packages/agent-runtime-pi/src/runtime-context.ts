import type { AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core'
import { normalizeToolCallHistory, type AgentMessage } from '@localixai/agent/agents'
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'
import { fromPiMessage, toPiMessage } from './message-codec'
import { isConversationalPiMessage } from './pi-transcript'

/** Localix conversation messages → pi wire messages (system/other roles dropped). */
export function toPiMessages(messages: readonly AgentMessage[]) {
  return normalizeToolCallHistory(messages).flatMap((message) =>
    'role' in message &&
    (message.role === 'user' || message.role === 'assistant' || message.role === 'tool')
      ? toPiMessage(message)
      : [],
  )
}

/** Keep Pi-owned system messages outside the host's conversational context policy. */
export function createContextTransform(
  input: Pick<AgentRuntimeRunInput, 'contextPolicy'>,
  signal: AbortSignal,
) {
  return input.contextPolicy
    ? async (messages: PiAgentMessage[]) => {
        const system = messages.filter((message) => message.role === 'system')
        const local = messages.flatMap((message) =>
          isConversationalPiMessage(message) ? [fromPiMessage(message)] : [],
        )
        const transformed = await input.contextPolicy!.transform(local, signal)
        return [...system, ...toPiMessages(transformed)]
      }
    : undefined
}
