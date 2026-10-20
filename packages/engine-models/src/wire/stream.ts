/**
 * ONE RESPONSE, assembled from the provider SDK's stream parts: each part becomes the delta the
 * loop forwards, and the parts together become the settled `AssistantMessage`.
 *
 * Parts arrive keyed by the provider's own ids; the message is keyed by position, so each id is
 * given the next content index when it starts. Provider state that has to ride back with a part
 * (signatures, item ids, encrypted reasoning) is folded into the part's signature string.
 */
import type {
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
  SharedV4ProviderMetadata,
} from '@ai-sdk/provider'
import type {
  AssistantMessage,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@localixai/agent'
import type { AgentMessageDelta, AgentMessageOrigin } from '@localixai/agent/agents'

import { stopReasonOf, usageOf, type AssembledUsage } from './finish'
import { parsePartialJson } from './partial-json'
import { encodeProviderState } from './provider-state'

type Part = TextContent | ThinkingContent | ToolCall

interface Slot {
  index: number
  metadata?: SharedV4ProviderMetadata
  /** Raw tool input as it streamed, for a tool-call slot. */
  input?: string
}

function merge(a: SharedV4ProviderMetadata | undefined, b: SharedV4ProviderMetadata | undefined) {
  if (!a) return b
  if (!b) return a
  const merged: SharedV4ProviderMetadata = { ...a }
  for (const [key, value] of Object.entries(b)) merged[key] = { ...a[key], ...value }
  return merged
}

function parseInput(input: unknown): unknown {
  if (typeof input !== 'string') return input ?? {}
  try {
    return JSON.parse(input)
  } catch {
    return parsePartialJson(input) ?? {}
  }
}

export class ResponseAssembler {
  private readonly content: Part[] = []
  private readonly slots = new Map<string, Slot>()
  private finish:
    | {
        reason: LanguageModelV4FinishReason
        usage: LanguageModelV4Usage
        metadata?: SharedV4ProviderMetadata
      }
    | undefined
  private responseId: string | undefined
  private responseModel: string | undefined
  /** The provider's error part, when the stream reported one. */
  error: unknown

  constructor(private readonly origin: AgentMessageOrigin) {}

  get hasContent(): boolean {
    return this.content.length > 0
  }

  private open(id: string, part: Part, metadata?: SharedV4ProviderMetadata): Slot {
    const slot: Slot = { index: this.content.length, ...(metadata ? { metadata } : {}) }
    this.content.push(part)
    this.slots.set(id, slot)
    return slot
  }

  /** The deltas one stream part stands for (none for bookkeeping parts). */
  push(part: LanguageModelV4StreamPart): AgentMessageDelta[] {
    const origin = this.origin
    switch (part.type) {
      case 'text-start': {
        const slot = this.open(part.id, { type: 'text', text: '' }, part.providerMetadata)
        return [{ kind: 'text', phase: 'start', contentIndex: slot.index, delta: '', origin }]
      }
      case 'text-delta': {
        const slot = this.slots.get(part.id) ?? this.open(part.id, { type: 'text', text: '' })
        ;(this.content[slot.index] as TextContent).text += part.delta
        return [
          { kind: 'text', phase: 'delta', contentIndex: slot.index, delta: part.delta, origin },
        ]
      }
      case 'text-end': {
        const slot = this.slots.get(part.id)
        if (!slot) return []
        const signature = encodeProviderState(merge(slot.metadata, part.providerMetadata))
        if (signature) (this.content[slot.index] as TextContent).textSignature = signature
        return [
          {
            kind: 'text',
            phase: 'end',
            contentIndex: slot.index,
            delta: '',
            origin,
            ...(signature ? { textSignature: signature } : {}),
          },
        ]
      }
      case 'reasoning-start': {
        const slot = this.open(part.id, { type: 'thinking', thinking: '' }, part.providerMetadata)
        return [{ kind: 'reasoning', phase: 'start', contentIndex: slot.index, delta: '', origin }]
      }
      case 'reasoning-delta': {
        const slot =
          this.slots.get(part.id) ?? this.open(part.id, { type: 'thinking', thinking: '' })
        ;(this.content[slot.index] as ThinkingContent).thinking += part.delta
        slot.metadata = merge(slot.metadata, part.providerMetadata)
        return [
          {
            kind: 'reasoning',
            phase: 'delta',
            contentIndex: slot.index,
            delta: part.delta,
            origin,
          },
        ]
      }
      case 'reasoning-end': {
        const slot = this.slots.get(part.id)
        if (!slot) return []
        const metadata = merge(slot.metadata, part.providerMetadata)
        const block = this.content[slot.index] as ThinkingContent
        const signature = encodeProviderState(metadata)
        if (signature) block.thinkingSignature = signature
        const redacted = metadata?.anthropic?.redactedData !== undefined
        if (redacted) block.redacted = true
        return [
          {
            kind: 'reasoning',
            phase: 'end',
            contentIndex: slot.index,
            delta: '',
            origin,
            ...(signature ? { thinkingSignature: signature } : {}),
            ...(redacted ? { redacted: true } : {}),
          },
        ]
      }
      case 'tool-input-start': {
        const slot = this.open(
          part.id,
          { type: 'tool_call', id: part.id, name: part.toolName, arguments: {} },
          part.providerMetadata,
        )
        slot.input = ''
        return [
          {
            kind: 'tool_call',
            phase: 'start',
            contentIndex: slot.index,
            delta: '',
            id: part.id,
            name: part.toolName,
            input: {},
            origin,
          },
        ]
      }
      case 'tool-input-delta': {
        const slot = this.slots.get(part.id)
        if (!slot) return []
        slot.input = (slot.input ?? '') + part.delta
        const call = this.content[slot.index] as ToolCall
        // Keep the last input that parsed: a half-written literal must not blank the card.
        const input = parsePartialJson(slot.input) ?? call.arguments
        call.arguments = input
        return [
          {
            kind: 'tool_call',
            phase: 'delta',
            contentIndex: slot.index,
            delta: part.delta,
            id: call.id,
            name: call.name,
            input,
            origin,
          },
        ]
      }
      case 'tool-call': {
        if (part.providerExecuted) return []
        const slot =
          this.slots.get(part.toolCallId) ??
          this.open(part.toolCallId, {
            type: 'tool_call',
            id: part.toolCallId,
            name: part.toolName,
            arguments: {},
          })
        const call = this.content[slot.index] as ToolCall
        call.name = part.toolName
        call.arguments = parseInput(part.input)
        const signature = encodeProviderState(merge(slot.metadata, part.providerMetadata))
        if (signature) call.thoughtSignature = signature
        return [
          {
            kind: 'tool_call',
            phase: 'end',
            contentIndex: slot.index,
            delta: '',
            id: call.id,
            name: call.name,
            input: call.arguments,
            origin,
            ...(signature ? { thoughtSignature: signature } : {}),
          },
        ]
      }
      case 'response-metadata':
        if (part.id) this.responseId = part.id
        if (part.modelId) this.responseModel = part.modelId
        return []
      case 'finish':
        this.finish = {
          reason: part.finishReason,
          usage: part.usage,
          ...(part.providerMetadata ? { metadata: part.providerMetadata } : {}),
        }
        return []
      case 'error':
        this.error = part.error
        return []
      default:
        return []
    }
  }

  /** The settled message and its token counts. `stopReason` follows the stream's own ending. */
  settle(ending: { aborted: boolean; error?: Error }): {
    message: AssistantMessage
    usage?: AssembledUsage
    /** What the provider attached to the response's end (OpenRouter's billed cost, …). */
    metadata?: SharedV4ProviderMetadata
  } {
    const hasToolCalls = this.content.some((part) => part.type === 'tool_call')
    const stopReason: StopReason = ending.aborted
      ? 'aborted'
      : ending.error
        ? 'error'
        : this.finish
          ? stopReasonOf(this.finish.reason, hasToolCalls)
          : 'error'
    const errorMessage =
      ending.error?.message ??
      (stopReason === 'error'
        ? this.finish?.reason.unified === 'content-filter'
          ? 'The provider filtered the response.'
          : 'The provider ended the response without finishing it.'
        : undefined)
    const message: AssistantMessage = {
      role: 'assistant',
      content: this.content,
      ...(this.origin.api ? { api: this.origin.api } : {}),
      ...(this.origin.provider ? { provider: this.origin.provider } : {}),
      model: this.origin.model,
      ...(this.responseModel ? { responseModel: this.responseModel } : {}),
      ...(this.responseId ? { responseId: this.responseId } : {}),
      stopReason,
      ...(errorMessage && stopReason !== 'aborted' ? { errorMessage } : {}),
      timestamp: Date.now(),
    }
    if (!this.finish) return { message }
    return {
      message,
      usage: usageOf(this.finish.usage),
      ...(this.finish.metadata ? { metadata: this.finish.metadata } : {}),
    }
  }
}
