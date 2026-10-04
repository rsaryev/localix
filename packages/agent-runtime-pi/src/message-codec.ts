import type { AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core'
import type { ConversationalPiMessage } from './pi-transcript'
import type {
  AssistantMessage as PiAssistantMessage,
  AssistantMessageEvent as PiAssistantMessageEvent,
  ImageContent as PiImageContent,
  JsonObject as PiJsonObject,
  JsonValue as PiJsonValue,
  TextContent as PiTextContent,
  ToolResultMessage as PiToolResultMessage,
  UserMessage as PiUserMessage,
} from '@earendil-works/pi-ai'

import type {
  AgentMessage,
  AgentMessageDelta,
  AgentMessageOrigin,
  AgentToolResult,
} from '@localixai/agent/agents'
import type {
  AssistantMessage,
  FileContent,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from '@localixai/agent'

export type PiContent = PiTextContent | PiImageContent

/**
 * OUR `unknown` IS THEIR `JsonValue` — asserted once, here, where the two shapes meet.
 *
 * Upstream narrowed three fields to JSON-compatible types at `59eb4c39`: a tool result's
 * `details`, a tool call's `arguments`, a diagnostic's `details`. Each reached this codec out of a
 * stored JSON payload or an SSE frame and leaves it to be serialized back into one, so each is
 * JSON by construction — TypeScript cannot see a round trip through `JSON.parse`. A runtime walk
 * would re-establish per turn what storage already guarantees, and its failure would have nowhere
 * to go. The narrowness is the safety: nothing else here casts, so a field that genuinely is not
 * JSON fails to compile rather than slipping through.
 */
const asJsonValue = (value: unknown): PiJsonValue | undefined =>
  value === undefined ? undefined : (value as PiJsonValue)

const asJsonObject = (value: Record<string, unknown>): PiJsonObject => value as PiJsonObject

/**
 * pi's `pending` and `deferred` are NOT terminal: the first marks a message still
 * streaming, the second one parked on the provider for later retrieval. The
 * engine-neutral contract has no member for "has not stopped yet", so both map to
 * undefined rather than borrowing a terminal reason the UI would render as final.
 */
function toStopReason(
  stopReason: PiAssistantMessage['stopReason'],
): AssistantMessage['stopReason'] {
  if (stopReason === 'stop') return 'end_turn'
  if (stopReason === 'toolUse') return 'tool_use'
  if (stopReason === 'length') return 'max_tokens'
  if (stopReason === 'error' || stopReason === 'aborted') return stopReason
  return undefined
}

const LOCAL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function toPiImage(content: ImageContent): PiImageContent {
  return { type: 'image', data: content.data, mimeType: content.mediaType }
}

export function toPiPart(part: TextContent | ImageContent | FileContent): PiContent {
  if (part.type === 'text') return { type: 'text', text: part.text }
  if (part.type === 'image') return toPiImage(part)
  return { type: 'text', text: `[Attached file: ${part.filename ?? part.mediaType}]` }
}

function toPiParts(content: string | Array<TextContent | ImageContent | FileContent>): PiContent[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content.map(toPiPart)
}

function fromPiImage(part: PiImageContent): ImageContent | TextContent {
  if (!LOCAL_IMAGE_TYPES.has(part.mimeType)) {
    return { type: 'text', text: `[Unsupported image: ${part.mimeType}]` }
  }
  return {
    type: 'image',
    data: part.data,
    mediaType: part.mimeType as ImageContent['mediaType'],
  }
}

function fromPiParts(parts: readonly PiContent[]): Array<TextContent | ImageContent> {
  return parts.map((part) => (part.type === 'image' ? fromPiImage(part) : part))
}

/**
 * A host message becomes one or more pi messages — never a system one: the prompt and the
 * tool loadout are pi's to write (see `toPiSystemMessage` and `declareToolChanges`), which
 * is why the return type is narrowed rather than pi's full union.
 */
export function toPiMessage(message: Message): ConversationalPiMessage[] {
  if (message.role === 'user') {
    const result: PiUserMessage = {
      role: 'user',
      content: toPiParts(message.content),
      timestamp: message.timestamp,
      ...(message.cacheAnchor ? { cacheAnchor: true } : {}),
    }
    return [result]
  }
  if (message.role === 'tool') {
    // One wire message fans out to one pi message per result; the provider re-groups them
    // into a single turn, so the anchor rides the LAST one (the group's last block).
    return message.results.map(
      (result, index): PiToolResultMessage => ({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        content: toPiParts(result.content),
        details: asJsonValue(result.details),
        isError: result.isError ?? false,
        timestamp: message.timestamp,
        ...(message.cacheAnchor && index === message.results.length - 1
          ? { cacheAnchor: true }
          : {}),
      }),
    )
  }
  const result: PiAssistantMessage = {
    role: 'assistant',
    content: message.content.map((part) =>
      part.type === 'tool_call'
        ? {
            type: 'toolCall' as const,
            id: part.id,
            name: part.name,
            arguments:
              typeof part.arguments === 'object' && part.arguments !== null
                ? asJsonObject(part.arguments as Record<string, unknown>)
                : {},
            thoughtSignature: part.thoughtSignature,
          }
        : part,
    ),
    api: message.api ?? 'openai-completions',
    provider: message.provider ?? '',
    model: message.model,
    responseModel: message.responseModel,
    responseId: message.responseId,
    diagnostics: message.diagnostics?.map((diagnostic) => ({
      type: diagnostic.type,
      timestamp: diagnostic.timestamp ?? message.timestamp,
      ...(diagnostic.error
        ? { error: diagnostic.error }
        : diagnostic.message
          ? { error: { message: diagnostic.message } }
          : {}),
      ...(diagnostic.details ? { details: asJsonObject(diagnostic.details) } : {}),
    })),
    stopReason:
      message.stopReason === 'end_turn' || message.stopReason === 'stop_sequence'
        ? 'stop'
        : message.stopReason === 'tool_use'
          ? 'toolUse'
          : message.stopReason === 'max_tokens'
            ? 'length'
            : (message.stopReason ?? 'stop'),
    errorMessage: message.errorMessage,
    timestamp: message.timestamp,
    ...(message.cacheAnchor ? { cacheAnchor: true } : {}),
    usage: {
      input: Math.max(
        0,
        (message.usage?.inputTokens ?? 0) -
          (message.usage?.cacheReadTokens ?? 0) -
          (message.usage?.cacheWriteTokens ?? 0),
      ),
      output: message.usage?.outputTokens ?? 0,
      cacheRead: message.usage?.cacheReadTokens ?? 0,
      cacheWrite: message.usage?.cacheWriteTokens ?? 0,
      cacheWrite1h: message.usage?.cacheWrite1hTokens,
      reasoning: message.usage?.reasoningTokens,
      // pi's `Usage.totalTokens` is a required number, so absence has to become
      // SOMETHING here — and `0` is the one answer that lies. `normalizeUsage`
      // (apps/api chat/runtime/usage-normalize.ts) states the rule: an absent total is
      // DERIVED as `input + output`, and it accepts a literal 0 as measured, so a
      // fabricated zero would suppress that derivation everywhere downstream.
      totalTokens:
        message.usage?.totalTokens ??
        (message.usage?.inputTokens ?? 0) + (message.usage?.outputTokens ?? 0),
      cost: {
        input: message.usage?.cost?.input ?? 0,
        output: message.usage?.cost?.output ?? 0,
        cacheRead: message.usage?.cost?.cacheRead ?? 0,
        cacheWrite: message.usage?.cost?.cacheWrite ?? 0,
        total: message.usage?.cost?.total ?? message.usage?.totalCost ?? 0,
      },
    },
  }
  return [result]
}

export function fromPiAssistant(message: PiAssistantMessage): AssistantMessage {
  return {
    role: 'assistant',
    ...(message.cacheAnchor ? { cacheAnchor: true } : {}),
    content: message.content.map((part): TextContent | ThinkingContent | ToolCall =>
      part.type === 'toolCall'
        ? {
            type: 'tool_call',
            id: part.id,
            name: part.name,
            arguments: part.arguments,
            thoughtSignature: part.thoughtSignature,
          }
        : part,
    ),
    api: message.api,
    provider: message.provider,
    model: message.model,
    responseModel: message.responseModel,
    responseId: message.responseId,
    diagnostics: message.diagnostics?.map((diagnostic) => ({
      ...diagnostic,
      ...(diagnostic.error?.message ? { message: diagnostic.error.message } : {}),
    })),
    usage: {
      inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
      outputTokens: message.usage.output,
      cacheReadTokens: message.usage.cacheRead,
      cacheWriteTokens: message.usage.cacheWrite,
      cacheWrite1hTokens: message.usage.cacheWrite1h,
      reasoningTokens: message.usage.reasoning,
      totalTokens: message.usage.totalTokens,
      totalCost: message.usage.cost.total,
      cost: { ...message.usage.cost },
    },
    stopReason: toStopReason(message.stopReason),
    errorMessage: message.errorMessage,
    timestamp: message.timestamp,
  }
}

export function fromPiMessage(message: ConversationalPiMessage): AgentMessage {
  if (message.role === 'assistant') return fromPiAssistant(message)
  if (message.role === 'user') {
    return {
      role: 'user',
      ...(message.cacheAnchor ? { cacheAnchor: true } : {}),
      content: typeof message.content === 'string' ? message.content : fromPiParts(message.content),
      timestamp: message.timestamp,
    }
  }
  return {
    role: 'tool',
    ...(message.cacheAnchor ? { cacheAnchor: true } : {}),
    results: [
      {
        type: 'tool_result',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: fromPiParts(message.content),
        isError: message.isError,
        details: message.details,
      },
    ],
    timestamp: message.timestamp,
  } satisfies ToolResultMessage
}

export function requirePiAssistant(message: PiAgentMessage): PiAssistantMessage {
  if (message.role !== 'assistant') {
    throw new Error(`Expected pi assistant message, received ${message.role}`)
  }
  return message
}

export function toolResultFromPi(result: {
  content: readonly PiContent[]
  details?: unknown
}): AgentToolResult {
  return {
    content: result.content
      .flatMap((part) => (part.type === 'text' ? [part.text] : ['[image]']))
      .join(''),
    contentParts: fromPiParts(result.content),
    details: result.details,
  }
}

function originOf(message: PiAssistantMessage): AgentMessageOrigin {
  return {
    api: message.api,
    provider: message.provider,
    model: message.model,
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
      return {
        kind: 'text',
        phase: 'start',
        contentIndex: event.contentIndex,
        delta: '',
        origin,
        ...(part?.type === 'text' && part.textSignature
          ? { textSignature: part.textSignature }
          : {}),
      }
    case 'text_delta':
      return {
        kind: 'text',
        phase: 'delta',
        contentIndex: event.contentIndex,
        delta: event.delta,
        origin,
        ...(part?.type === 'text' && part.textSignature
          ? { textSignature: part.textSignature }
          : {}),
      }
    case 'text_end':
      return {
        kind: 'text',
        phase: 'end',
        contentIndex: event.contentIndex,
        delta: '',
        origin,
        ...(part?.type === 'text' && part.textSignature
          ? { textSignature: part.textSignature }
          : {}),
      }
    case 'thinking_start':
      return {
        kind: 'reasoning',
        phase: 'start',
        contentIndex: event.contentIndex,
        delta: '',
        origin,
        ...(part?.type === 'thinking' && part.thinkingSignature
          ? { thinkingSignature: part.thinkingSignature }
          : {}),
        ...(part?.type === 'thinking' && part.redacted ? { redacted: true } : {}),
      }
    case 'thinking_delta':
      return {
        kind: 'reasoning',
        phase: 'delta',
        contentIndex: event.contentIndex,
        delta: event.delta,
        origin,
        ...(part?.type === 'thinking' && part.thinkingSignature
          ? { thinkingSignature: part.thinkingSignature }
          : {}),
        ...(part?.type === 'thinking' && part.redacted ? { redacted: true } : {}),
      }
    case 'thinking_end':
      return {
        kind: 'reasoning',
        phase: 'end',
        contentIndex: event.contentIndex,
        delta: '',
        origin,
        ...(part?.type === 'thinking' && part.thinkingSignature
          ? { thinkingSignature: part.thinkingSignature }
          : {}),
        ...(part?.type === 'thinking' && part.redacted ? { redacted: true } : {}),
      }
    case 'toolcall_start':
      return {
        kind: 'tool_call',
        phase: 'start',
        contentIndex: event.contentIndex,
        id: part?.type === 'toolCall' ? part.id : '',
        name: part?.type === 'toolCall' ? part.name : '',
        input: part?.type === 'toolCall' ? part.arguments : {},
        delta: '',
        origin,
        ...(part?.type === 'toolCall' && part.thoughtSignature
          ? { thoughtSignature: part.thoughtSignature }
          : {}),
      }
    case 'toolcall_delta':
      return {
        kind: 'tool_call',
        phase: 'delta',
        contentIndex: event.contentIndex,
        id: part?.type === 'toolCall' ? part.id : '',
        name: part?.type === 'toolCall' ? part.name : '',
        input: part?.type === 'toolCall' ? part.arguments : {},
        delta: event.delta,
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
