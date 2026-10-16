import type { AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core'
import type { Message as PiMessage, SystemMessage as PiSystemMessage } from '@earendil-works/pi-ai'

/**
 * WHICH pi messages are the host's, and how the run's prompt becomes one of pi's.
 *
 * pi's transcript is no longer just the conversation. The run's instructions are its leading
 * system message, and each turn may add another declaring the tools the model may call —
 * both written by pi, both re-derived from the transcript, neither with a counterpart in the
 * engine-neutral model. That distinction decides three things at once (what the provider is
 * sent, what the host persists, what compaction may touch), so it is stated once, here,
 * rather than as a role check at each of those seams.
 */

/** A pi message the codec can carry into the engine-neutral model. */
export type ConversationalPiMessage = Exclude<PiMessage, { role: 'system' }>

/**
 * Messages the LLM request must carry — pi's system messages INCLUDED. Filtering them out of
 * `convertToLlm` would drop the prompt and the tool roster from every request.
 */
export function isPiMessage(message: PiAgentMessage): message is PiMessage {
  return (
    message.role === 'user' ||
    message.role === 'assistant' ||
    message.role === 'toolResult' ||
    message.role === 'system'
  )
}

/**
 * Messages that have an engine-neutral counterpart — what the host persists, renders and
 * compacts. A pi system message is deliberately NOT one: dropping it from a compaction
 * round-trip is safe, because the next turn re-derives the tool delta from the transcript,
 * while the leading prompt is carried across separately (see `runtime.ts`).
 */
export function isConversationalPiMessage(
  message: PiAgentMessage,
): message is ConversationalPiMessage {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
}

/**
 * The transcript's LEADING message: the run's system prompt.
 *
 * pi stopped carrying the prompt as a context field, so the host's `systemPrompt` input is
 * turned into the shape pi wants in exactly one place.
 */
export function toPiSystemMessage(systemPrompt: string): PiSystemMessage {
  return { role: 'system', content: systemPrompt, timestamp: Date.now() }
}
