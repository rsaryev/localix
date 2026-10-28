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
  SharedV4ProviderOptions,
} from '@ai-sdk/provider'
import type { AssistantMessage, ReasoningEffort } from '@localixai/agent'
import type { AgentMessageOrigin } from '@localixai/agent/agents'
import type { ModelTurnRequest } from '@localixai/agent/runtime'

import { attachedFromTools, toolOutput, userParts, type ToolOutputShape } from './media'
import { decodeProviderState } from './provider-state'
import { toolCallIdMapper, type ToolCallIdFormat } from './tool-call-ids'

/** How one provider family wants its requests shaped. */
export interface WireProfile {
  /** The `providerOptions` key its SDK reads (`openai`, `anthropic`, `google`, …). */
  namespace: string
  /** Its prompt cache reads explicit breakpoints (Anthropic `cache_control`), not a key. */
  cacheBreakpoints: boolean
  /** Options every request carries (store, cache key, reasoning summaries, …). */
  requestOptions?: (request: RequestContext) => Record<string, unknown> | undefined
  /** Headers every request carries: the session identity a provider routes its prompt cache by. */
  requestHeaders?: (request: RequestContext) => Record<string, string> | undefined
  /** The model takes a sampling temperature; models.dev says which do not (reasoning models mostly). */
  temperature: boolean
  /** The provider refuses a requested output limit (the ChatGPT backend). */
  refusesOutputLimit?: boolean
  /** The model reads images. When false, images are sent as a short placeholder. Default: true. */
  images?: boolean
  /**
   * The OpenAI-compatible chat wire: a tool message carries text only, and reasoning returns as
   * `reasoning_content`, which DeepSeek and Kimi want back within a tool loop.
   */
  compatible?: boolean
  /** The form of tool-call id the provider insists on, when it insists. */
  toolCallIds?: ToolCallIdFormat
  /** Which explicit breakpoints `cacheBreakpoints` places: Anthropic's (default) or Bedrock's. */
  cachePoints?: 'anthropic' | 'bedrock'
}

export interface RequestContext {
  sessionId: string
  /** What keys the provider's prompt cache instead of the session, when the host named one. */
  promptCacheKey?: string
  reasoningEffort: ReasoningEffort | undefined
  /** How long the session sat idle before this run, when the host measured it. */
  idleMs: number | undefined
  /** The host asked for the longest-lived prompt cache the provider offers (`long`). */
  cacheRetention?: 'short' | 'long'
}

const CACHE_POINT = {
  anthropic: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  bedrock: { bedrock: { cachePoint: { type: 'default' } } },
} as const

/** The model a stored message's provider state is valid for: the one that produced it. */
function sameOrigin(message: AssistantMessage, origin: AgentMessageOrigin | undefined): boolean {
  if (!origin) return true
  if (message.model !== origin.model) return false
  return message.provider === undefined || message.provider === origin.provider
}

/**
 * An assistant message replayed. Provider state — a signature, an encrypted reasoning item, an
 * item id — goes back only to the model that issued it, and never from a response that failed
 * or was stopped (OpenAI refuses a reasoning item whose following item never arrived). Reasoning
 * goes back only with that state, except on the OpenAI-compatible wire, where the model's own
 * reasoning returns as plain `reasoning_content`. Text and tool calls go back always.
 */
function assistantMessage(
  message: AssistantMessage,
  profile: WireProfile,
  origin: AgentMessageOrigin | undefined,
  callId: (id: string) => string,
): LanguageModelV4Message | undefined {
  const failed = message.stopReason === 'error' || message.stopReason === 'aborted'
  const keepState = sameOrigin(message, origin) && !failed
  const state = (signature: string | undefined) =>
    keepState ? decodeProviderState(signature) : undefined
  const content: Extract<LanguageModelV4Message, { role: 'assistant' }>['content'] = []
  for (const part of message.content) {
    if (part.type === 'text') {
      const providerOptions = state(part.textSignature)
      if (part.text || providerOptions)
        content.push({
          type: 'text',
          text: part.text,
          ...(providerOptions ? { providerOptions } : {}),
        })
    } else if (part.type === 'thinking') {
      if (!keepState) continue
      const providerOptions = decodeProviderState(part.thinkingSignature)
      if (providerOptions && Object.keys(providerOptions).length > 0)
        content.push({ type: 'reasoning', text: part.thinking, providerOptions })
      else if (profile.compatible && part.thinking.trim())
        content.push({ type: 'reasoning', text: part.thinking })
    } else {
      const providerOptions = state(part.thoughtSignature)
      content.push({
        type: 'tool-call',
        toolCallId: callId(part.id),
        toolName: part.name,
        input: part.arguments ?? {},
        ...(providerOptions ? { providerOptions } : {}),
      })
    }
  }
  return content.length > 0 ? { role: 'assistant', content } : undefined
}

/** Anthropic's one-hour cache write, for a run that asked for long retention. */
const LONG_CACHE_POINT = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } as const

function withCache(
  message: LanguageModelV4Message,
  points: WireProfile['cachePoints'],
  retention?: 'short' | 'long',
): LanguageModelV4Message {
  const point =
    retention === 'long' && (points ?? 'anthropic') === 'anthropic'
      ? LONG_CACHE_POINT
      : CACHE_POINT[points ?? 'anthropic']
  return {
    ...message,
    providerOptions: { ...message.providerOptions, ...point },
  } as LanguageModelV4Message
}

/**
 * The conversation as the SDK's prompt. `origin` is the model this request goes to; provider
 * state from any other is left out.
 */
export function buildPrompt(
  request: Pick<ModelTurnRequest, 'systemPrompt' | 'messages'>,
  profile: WireProfile,
  origin?: AgentMessageOrigin,
  retention?: 'short' | 'long',
) {
  const images = profile.images !== false
  const shape: ToolOutputShape = { images, textOnly: profile.compatible === true }
  const callId = toolCallIdMapper(profile.toolCallIds)
  const prompt: LanguageModelV4Message[] = [{ role: 'system', content: request.systemPrompt }]
  let anchor = -1
  for (const message of request.messages) {
    const wire: LanguageModelV4Message[] = []
    if (message.role === 'user') {
      wire.push({ role: 'user', content: userParts(message.content, images) })
    } else if (message.role === 'assistant') {
      const assistant = assistantMessage(message, profile, origin, callId)
      if (assistant) wire.push(assistant)
    } else {
      const follow: LanguageModelV4FilePart[] = []
      wire.push({
        role: 'tool',
        content: message.results.map((result) => {
          const shaped = toolOutput(result, shape)
          follow.push(...shaped.follow)
          return {
            type: 'tool-result' as const,
            toolCallId: callId(result.toolCallId),
            toolName: result.toolName,
            output: shaped.output,
          }
        }),
      })
      if (follow.length > 0) wire.push(attachedFromTools(follow))
    }
    if (wire.length === 0) continue
    if (message.cacheAnchor) anchor = prompt.length + wire.length - 1
    prompt.push(...wire)
  }
  if (profile.cacheBreakpoints) {
    // The system prompt (and the tools before it), the end of the history rebuilt byte for byte
    // next run, and the newest message: the three prefixes worth reading back.
    const points = profile.cachePoints
    prompt[0] = withCache(prompt[0]!, points, retention)
    if (anchor > 0) prompt[anchor] = withCache(prompt[anchor]!, points, retention)
    if (prompt.length > 1)
      prompt[prompt.length - 1] = withCache(prompt[prompt.length - 1]!, points, retention)
  }
  return prompt
}

export function buildCallOptions(
  request: ModelTurnRequest,
  profile: WireProfile,
  context: RequestContext,
  origin?: AgentMessageOrigin,
): LanguageModelV4CallOptions {
  const extra = profile.requestOptions?.(context)
  const headers = profile.requestHeaders?.(context)
  const providerOptions: SharedV4ProviderOptions | undefined = extra
    ? ({ [profile.namespace]: extra } as SharedV4ProviderOptions)
    : undefined
  return {
    prompt: buildPrompt(request, profile, origin, context.cacheRetention),
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
    ...(headers ? { headers } : {}),
    abortSignal: request.signal,
  }
}
