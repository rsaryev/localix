import type {
  AssistantMessage as PiAssistantMessage,
  AssistantMessageEvent as PiAssistantMessageEvent,
} from '@earendil-works/pi-ai'
import type { AgentMessageDelta, AgentMessageOrigin } from '@localixai/agent/agents'

function originOf(message: PiAssistantMessage): AgentMessageOrigin {
  return {
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...(message.providerThinkingLevel
      ? { providerThinkingLevel: message.providerThinkingLevel }
      : {}),
  }
}

/**
 * Translate one Pi part update without converting its cumulative partial message.
 *
 * Pi's `partial.content` grows throughout a response. Mapping that whole array on
 * every token made the adapter itself O(total generated content²), before the host
 * saw the event. Direct indexed access keeps this boundary O(size of this delta);
 * `message_end` still decodes the complete message once as the reconciliation
 * checkpoint.
 */
export function mapAssistantDelta(event: PiAssistantMessageEvent): AgentMessageDelta | undefined {
  if (event.type === 'start' || event.type === 'done' || event.type === 'error') return undefined
  const origin = originOf(event.partial)
  const part = event.partial.content[event.contentIndex]
  switch (event.type) {
    case 'text_start':
    case 'text_delta':
    case 'text_end':
      return {
        kind: 'text',
        phase: event.type === 'text_start' ? 'start' : event.type === 'text_end' ? 'end' : 'delta',
        contentIndex: event.contentIndex,
        delta: event.type === 'text_delta' ? event.delta : '',
        origin,
        ...(part?.type === 'text' && part.textSignature
          ? { textSignature: part.textSignature }
          : {}),
      }
    case 'thinking_start':
    case 'thinking_delta':
    case 'thinking_end':
      return {
        kind: 'reasoning',
        phase:
          event.type === 'thinking_start'
            ? 'start'
            : event.type === 'thinking_end'
              ? 'end'
              : 'delta',
        contentIndex: event.contentIndex,
        delta: event.type === 'thinking_delta' ? event.delta : '',
        origin,
        ...(part?.type === 'thinking' && part.thinkingSignature
          ? { thinkingSignature: part.thinkingSignature }
          : {}),
        ...(part?.type === 'thinking' && part.redacted ? { redacted: true } : {}),
      }
    case 'toolcall_start':
    case 'toolcall_delta':
      return {
        kind: 'tool_call',
        phase: event.type === 'toolcall_start' ? 'start' : 'delta',
        contentIndex: event.contentIndex,
        id: part?.type === 'toolCall' ? part.id : '',
        name: part?.type === 'toolCall' ? part.name : '',
        input: part?.type === 'toolCall' ? part.arguments : {},
        delta: event.type === 'toolcall_delta' ? event.delta : '',
        origin,
        ...(part?.type === 'toolCall' && part.thoughtSignature
          ? { thoughtSignature: part.thoughtSignature }
          : {}),
      }
    case 'toolcall_end':
      return {
        kind: 'tool_call',
        phase: 'end',
        contentIndex: event.contentIndex,
        id: event.toolCall.id,
        name: event.toolCall.name,
        input: event.toolCall.arguments,
        delta: '',
        origin,
        ...(event.toolCall.thoughtSignature
          ? { thoughtSignature: event.toolCall.thoughtSignature }
          : {}),
      }
  }
}
