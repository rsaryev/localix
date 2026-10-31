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
import { encodeProviderState, mergeMetadata as merge } from './provider-state'
import { parseToolInput, StreamingToolInput } from './tool-input'

type Part = TextContent | ThinkingContent | ToolCall

interface Slot {
  index: number
  metadata?: SharedV4ProviderMetadata
  /** The input as it streams, for a tool-call slot. */
  input?: StreamingToolInput
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

  constructor(
    private readonly origin: AgentMessageOrigin,
    private readonly now: () => number = () => performance.now(),
  ) {}

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
        // Gemini signs text parts too (`thoughtSignature` on a delta); it must ride back.
        slot.metadata = merge(slot.metadata, part.providerMetadata)
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
        // A tool the provider runs itself is not the loop's to call.
        if (part.providerExecuted) return []
        const slot = this.open(
          part.id,
          { type: 'tool_call', id: part.id, name: part.toolName, arguments: {} },
          part.providerMetadata,
        )
        slot.input = new StreamingToolInput()
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
        if (!slot?.input) return []
        const call = this.content[slot.index] as ToolCall
        const input = slot.input.push(part.delta, this.now())
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
        call.arguments = parseToolInput(part.input)
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
      // The input is final with `tool-call`. The rest is bookkeeping or content this loop does
      // not carry: provider-run tools and results, approvals, sources, files, custom parts.
      case 'tool-input-end':
      case 'stream-start':
      case 'raw':
      case 'tool-result':
      case 'tool-approval-request':
      case 'source':
      case 'file':
      case 'reasoning-file':
      case 'custom':
        return []
    }
  }

  /** The finish reason, when the stream reported one. */
  get finishReason(): LanguageModelV4FinishReason | undefined {
    return this.finish?.reason
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
