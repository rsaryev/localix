/** Assistant content scanning, item reconciliation and incremental provider-delta folding. */
import type { AssistantMessage, ToolCall } from '@localixai/agent'
import type { AgentMessageDelta } from '@localixai/agent/agents'
import type { TurnEventContext } from './event-handlers'
import { collapseDoubledText } from './doubled-text'

/** Everything the two message handlers need from the streamed assistant content. */
interface AssistantContentScan {
  /** Concatenated text parts — identical to `getTextContent`. */
  text: string
  /** Concatenated thinking parts — identical to `getThinkingContent`. */
  reasoning: string
  /** Tool calls, in content order — identical to `getToolCalls`. */
  toolCalls: ToolCall[]
  parts: Array<
    | { type: 'text'; contentIndex: number; text: string; textSignature?: string }
    | {
        type: 'reasoning'
        contentIndex: number
        text: string
        thinkingSignature?: string
        redacted?: boolean
      }
    | { type: 'tool'; contentIndex: number; call: ToolCall }
  >
}

/**
 * ONE pass over `message.content` for all four derivations.
 *
 * This scan is reserved for the terminal `message_end` reconciliation. Live
 * `message_update` frames are folded from their engine-neutral delta and never
 * inspect cumulative content.
 *
 * Text parts use the same doubled-text normalization as their transcript items.
 * Concatenation preserves authored content order, while parts retain their positions,
 * signatures and tool calls for item reconciliation.
 */
export function scanAssistantContent(message: AssistantMessage): AssistantContentScan {
  let text = ''
  let reasoning = ''
  const toolCalls: ToolCall[] = []
  const parts: AssistantContentScan['parts'] = []
  for (const [contentIndex, c] of message.content.entries()) {
    if (c.type === 'text') {
      // Once, here, so `content` and the text item cannot disagree (`doubled-text.ts`).
      const spoken = collapseDoubledText(c.text)
      text += spoken
      parts.push({ type: 'text', contentIndex, text: spoken, textSignature: c.textSignature })
    } else if (c.type === 'thinking') {
      reasoning += c.thinking
      parts.push({
        type: 'reasoning',
        contentIndex,
        text: c.thinking,
        thinkingSignature: c.thinkingSignature,
        redacted: c.redacted,
      })
    } else if (c.type === 'tool_call') {
      toolCalls.push(c)
      parts.push({ type: 'tool', contentIndex, call: c })
    }
  }
  return { text, reasoning, toolCalls, parts }
}

export function syncAssistantParts(
  acc: TurnEventContext['acc'],
  turnIndex: number,
  message: AssistantMessage,
  parts: AssistantContentScan['parts'],
) {
  const origin = { api: message.api, provider: message.provider, model: message.model }
  for (const part of parts) {
    if (part.type === 'text') {
      acc.text(turnIndex, part.text, part.contentIndex, {
        ...origin,
        textSignature: part.textSignature,
      })
    } else if (part.type === 'reasoning') {
      acc.reasoning(turnIndex, part.text, part.contentIndex, {
        ...origin,
        thinkingSignature: part.thinkingSignature,
        redacted: part.redacted,
      })
    } else {
      if (!part.call.id) continue
      acc.streamTool(turnIndex, {
        ...part.call,
        contentIndex: part.contentIndex,
        ...origin,
      })
    }
  }
}

/**
 * Fold one engine-neutral provider delta into the current assistant payload.
 *
 * There is deliberately no cumulative `AssistantMessage` argument here. Each
 * frame touches one content part and appends only its own fragment; the terminal
 * `message_end` handler performs the single authoritative full-message scan.
 */
export function applyAssistantDelta(
  ctx: Pick<TurnEventContext, 'state' | 'acc'>,
  delta: AgentMessageDelta,
): { narrative: boolean; toolCall: boolean } {
  const { state, acc } = ctx
  const turnIndex = state.currentTurnIndex
  if (delta.kind === 'text') {
    state.currentTurnText += delta.delta
    acc.appendText(turnIndex, delta.delta, delta.contentIndex, {
      ...delta.origin,
      ...(delta.textSignature ? { textSignature: delta.textSignature } : {}),
    })
  } else if (delta.kind === 'reasoning') {
    state.currentTurnReasoning += delta.delta
    acc.appendReasoning(turnIndex, delta.delta, delta.contentIndex, {
      ...delta.origin,
      ...(delta.thinkingSignature ? { thinkingSignature: delta.thinkingSignature } : {}),
      ...(delta.redacted ? { redacted: true } : {}),
    })
  } else if (delta.id) {
    acc.streamTool(turnIndex, {
      id: delta.id,
      name: delta.name,
      arguments: delta.input,
      contentIndex: delta.contentIndex,
      thoughtSignature: delta.thoughtSignature,
      ...delta.origin,
    })
  }

  state.payload = {
    ...state.payload,
    // A protocol-repair turn often emits whitespace before `conversation_control`. Whitespace cannot erase
    // an earlier public response; meaningful text still becomes the current canonical draft.
    content: state.currentTurnText.trim() ? state.currentTurnText : state.payload.content,
    items: acc.list(),
    ...(state.currentTurnReasoning ? { reasoning: state.currentTurnReasoning } : {}),
  }
  state.currentPayload = state.payload
  return {
    narrative: (delta.kind === 'text' || delta.kind === 'reasoning') && delta.delta.length > 0,
    toolCall: delta.kind === 'tool_call' && Boolean(delta.id),
  }
}
