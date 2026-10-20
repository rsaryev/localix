/**
 * ONE MODEL REQUEST in the provider SDK's terms: the conversation, the tools and the settings of
 * a `ModelTurnRequest`, as `LanguageModelV4CallOptions`.
 *
 * What differs between providers is not here but in the `WireProfile` the request is built for:
 * which `providerOptions` namespace it reads, whether its prompt cache needs explicit
 * breakpoints, and the options every request of it carries.
 */
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4FilePart,
  LanguageModelV4Message,
  LanguageModelV4TextPart,
  LanguageModelV4ToolResultOutput,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider'
import type {
  AssistantMessage,
  FileContent,
  ImageContent,
  Message,
  ReasoningEffort,
  TextContent,
  ToolResult,
} from '@localixai/agent'
import type { ModelTurnRequest } from '@localixai/agent/runtime'

import { decodeProviderState } from './provider-state'

/** How one provider family wants its requests shaped. */
export interface WireProfile {
  /** The `providerOptions` key its SDK reads (`openai`, `anthropic`, `google`, …). */
  namespace: string
  /** Its prompt cache reads explicit breakpoints (Anthropic `cache_control`), not a key. */
  cacheBreakpoints: boolean
  /** Options every request carries (store, cache key, reasoning summaries, …). */
  requestOptions?: (request: RequestContext) => Record<string, unknown> | undefined
  /** The model takes a sampling temperature; models.dev says which do not (reasoning models mostly). */
  temperature: boolean
  /** The provider refuses a requested output limit (the ChatGPT backend). */
  refusesOutputLimit?: boolean
}

export interface RequestContext {
  sessionId: string
  reasoningEffort: ReasoningEffort | undefined
  /** How long the session sat idle before this run, when the host measured it. */
  idleMs: number | undefined
}

const EPHEMERAL = { cacheControl: { type: 'ephemeral' } }

function fileData(data: string) {
  return { type: 'data' as const, data }
}

function userParts(
  content: Message['content'] & (string | Array<TextContent | ImageContent | FileContent>),
) {
  if (typeof content === 'string')
    return [{ type: 'text', text: content } satisfies LanguageModelV4TextPart]
  return content.map((part): LanguageModelV4TextPart | LanguageModelV4FilePart =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : part.type === 'image'
        ? { type: 'file', mediaType: part.mediaType, data: fileData(part.data) }
        : {
            type: 'file',
            mediaType: part.mediaType,
            data: fileData(part.data),
            ...(part.filename ? { filename: part.filename } : {}),
          },
  )
}

function toolOutput(result: ToolResult): LanguageModelV4ToolResultOutput {
  const parts =
    typeof result.content === 'string'
      ? [{ type: 'text' as const, text: result.content }]
      : result.content
  const media = parts.some((part) => part.type !== 'text')
  if (!media) {
    const value = parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
    return result.isError ? { type: 'error-text', value } : { type: 'text', value }
  }
  return {
    type: 'content',
    value: parts.map((part) =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text }
        : {
            type: 'file' as const,
            mediaType: part.mediaType,
            data: fileData(part.data),
            ...(part.type === 'file' && part.filename ? { filename: part.filename } : {}),
          },
    ),
  }
}

/**
 * An assistant message replayed. Reasoning goes back only with the state its provider needs to
 * accept it — a signature, an encrypted item — and only to the provider that issued it; text and
 * tool calls go back always, their state attached where there is some.
 */
function assistantMessage(
  message: AssistantMessage,
  profile: WireProfile,
): LanguageModelV4Message | undefined {
  const content: Extract<LanguageModelV4Message, { role: 'assistant' }>['content'] = []
  for (const part of message.content) {
    if (part.type === 'text') {
      const providerOptions = decodeProviderState(part.textSignature, 'text', message.api)
      if (part.text || providerOptions)
        content.push({
          type: 'text',
          text: part.text,
          ...(providerOptions ? { providerOptions } : {}),
        })
    } else if (part.type === 'thinking') {
      const providerOptions = decodeProviderState(
        part.thinkingSignature,
        'reasoning',
        message.api,
        {
          redacted: part.redacted === true,
        },
      )
      if (providerOptions?.[profile.namespace])
        content.push({ type: 'reasoning', text: part.thinking, providerOptions })
    } else {
      const providerOptions = decodeProviderState(part.thoughtSignature, 'tool-call', message.api)
      content.push({
        type: 'tool-call',
        toolCallId: part.id,
        toolName: part.name,
        input: part.arguments ?? {},
        ...(providerOptions ? { providerOptions } : {}),
      })
    }
  }
  return content.length > 0 ? { role: 'assistant', content } : undefined
}

function withCache(message: LanguageModelV4Message): LanguageModelV4Message {
  return {
    ...message,
    providerOptions: { ...message.providerOptions, anthropic: EPHEMERAL },
  } as LanguageModelV4Message
}

export function buildPrompt(
  request: Pick<ModelTurnRequest, 'systemPrompt' | 'messages'>,
  profile: WireProfile,
) {
  const prompt: LanguageModelV4Message[] = [{ role: 'system', content: request.systemPrompt }]
  let anchor = -1
  for (const message of request.messages) {
    let wire: LanguageModelV4Message | undefined
    if (message.role === 'user') wire = { role: 'user', content: userParts(message.content) }
    else if (message.role === 'assistant') wire = assistantMessage(message, profile)
    else
      wire = {
        role: 'tool',
        content: message.results.map((result) => ({
          type: 'tool-result' as const,
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          output: toolOutput(result),
        })),
      }
    if (!wire) continue
    if (message.cacheAnchor) anchor = prompt.length
    prompt.push(wire)
  }
  if (profile.cacheBreakpoints) {
    // The system prompt (and the tools before it), the end of the history rebuilt byte for byte
    // next run, and the newest message: the three prefixes worth reading back.
    prompt[0] = withCache(prompt[0]!)
    if (anchor > 0) prompt[anchor] = withCache(prompt[anchor]!)
    if (prompt.length > 1) prompt[prompt.length - 1] = withCache(prompt[prompt.length - 1]!)
  }
  return prompt
}

export function buildCallOptions(
  request: ModelTurnRequest,
  profile: WireProfile,
  context: RequestContext,
): LanguageModelV4CallOptions {
  const extra = profile.requestOptions?.(context)
  const providerOptions: SharedV4ProviderOptions | undefined = extra
    ? ({ [profile.namespace]: extra } as SharedV4ProviderOptions)
    : undefined
  return {
    prompt: buildPrompt(request, profile),
    ...(request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function' as const,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as never,
          })),
          toolChoice: { type: 'auto' as const },
        }
      : {}),
    ...(request.maxOutputTokens && !profile.refusesOutputLimit
      ? { maxOutputTokens: request.maxOutputTokens }
      : {}),
    ...(request.temperature !== undefined && profile.temperature
      ? { temperature: request.temperature }
      : {}),
    ...(request.reasoningEffort
      ? {
          reasoning:
            request.reasoningEffort === 'off' ? ('none' as const) : request.reasoningEffort,
        }
      : {}),
    ...(providerOptions ? { providerOptions } : {}),
    abortSignal: request.signal,
  }
}
