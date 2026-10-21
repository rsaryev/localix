/**
 * WHAT A RESPONSE CUT SHORT COST. The SDK reports usage only with its `finish` part, so a response
 * stopped, failed or cut off mid-stream would otherwise cost nothing in the ledger while the
 * provider bills it. The provider's own events often say more on the way (Anthropic's
 * `message_start` and `message_delta`, Gemini's `usageMetadata` on every chunk, the last chunk of
 * a chat completion, a Responses `response.incomplete`); what they leave unsaid is estimated from
 * the characters sent and received, about four to a token. The result is marked `estimated`, so it
 * is priced but never read as a measured context size.
 */
import type { LanguageModelV4Prompt, LanguageModelV4StreamPart } from '@ai-sdk/provider'

import type { AssembledUsage } from './finish'

const CHARS_PER_TOKEN = 4

type Counts = Partial<AssembledUsage>

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

/** The counts one provider event carries, in any of the shapes the supported APIs use. */
export function countsOf(raw: unknown): Counts | undefined {
  const event = record(raw)
  if (!event) return undefined
  // Anthropic (direct, Vertex): input on `message_start`, the running output on `message_delta`.
  const anthropic =
    record(record(event.message)?.usage) ??
    (event.type === 'message_delta' ? record(event.usage) : undefined)
  if (anthropic && ('input_tokens' in anthropic || 'output_tokens' in anthropic)) {
    const cacheRead = num(anthropic.cache_read_input_tokens)
    const cacheWrite = num(anthropic.cache_creation_input_tokens)
    const fresh = num(anthropic.input_tokens)
    return {
      ...(fresh !== undefined ? { inputTokens: fresh + (cacheRead ?? 0) + (cacheWrite ?? 0) } : {}),
      ...(num(anthropic.output_tokens) !== undefined
        ? { outputTokens: num(anthropic.output_tokens) }
        : {}),
      ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    }
  }
  // Gemini: every chunk carries the totals so far.
  const gemini = record(event.usageMetadata)
  if (gemini) {
    const thoughts = num(gemini.thoughtsTokenCount)
    return {
      ...(num(gemini.promptTokenCount) !== undefined
        ? { inputTokens: num(gemini.promptTokenCount) }
        : {}),
      outputTokens: (num(gemini.candidatesTokenCount) ?? 0) + (thoughts ?? 0),
      ...(num(gemini.cachedContentTokenCount) !== undefined
        ? { cacheReadTokens: num(gemini.cachedContentTokenCount) }
        : {}),
      ...(thoughts !== undefined ? { reasoningTokens: thoughts } : {}),
    }
  }
  // Bedrock Converse: the stream's `metadata` event.
  const bedrock = record(record(event.metadata)?.usage)
  if (bedrock) {
    const cacheRead = num(bedrock.cacheReadInputTokens)
    const cacheWrite = num(bedrock.cacheWriteInputTokens)
    return {
      ...(num(bedrock.inputTokens) !== undefined
        ? { inputTokens: (num(bedrock.inputTokens) ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0) }
        : {}),
      ...(num(bedrock.outputTokens) !== undefined
        ? { outputTokens: num(bedrock.outputTokens) }
        : {}),
      ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    }
  }
  // OpenAI Responses (`response.incomplete`, `response.failed`) and chat completions (last chunk).
  const usage = record(record(event.response)?.usage) ?? record(event.usage)
  if (!usage) return undefined
  const input = num(usage.input_tokens) ?? num(usage.prompt_tokens)
  const output = num(usage.output_tokens) ?? num(usage.completion_tokens)
  const inputDetails = record(usage.input_tokens_details) ?? record(usage.prompt_tokens_details)
  const outputDetails =
    record(usage.output_tokens_details) ?? record(usage.completion_tokens_details)
  const cached = num(inputDetails?.cached_tokens)
  const reasoning = num(outputDetails?.reasoning_tokens)
  return {
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(cached !== undefined ? { cacheReadTokens: cached } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  }
}

/**
 * The characters of a request a model reads as text: the prompt and the tools it declares (on an
 * agent's request the larger part), without inline file bytes.
 */
function requestChars(prompt: LanguageModelV4Prompt, tools: unknown): number {
  return JSON.stringify({ prompt, tools }, (key, value: unknown) =>
    key === 'data' && typeof value === 'string' && value.length > 1_000 ? '' : value,
  ).length
}

/** One request's usage, as far as the stream reported or let it be estimated. */
export class PartialUsage {
  private counts: Counts = {}
  private outputChars = 0

  constructor(
    private readonly prompt: LanguageModelV4Prompt,
    private readonly tools?: unknown,
  ) {}

  observe(part: LanguageModelV4StreamPart): void {
    if (part.type === 'raw') {
      const counts = countsOf(part.rawValue)
      if (counts) this.counts = { ...this.counts, ...counts }
    } else if (
      part.type === 'text-delta' ||
      part.type === 'reasoning-delta' ||
      part.type === 'tool-input-delta'
    ) {
      this.outputChars += part.delta.length
    }
  }

  /**
   * Undefined when the response neither said a word nor reported a count: a request refused,
   * overloaded or never sent is not billed.
   */
  settle(): AssembledUsage | undefined {
    if (this.outputChars === 0 && Object.keys(this.counts).length === 0) return undefined
    const estimate = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)
    return {
      ...this.counts,
      inputTokens: this.counts.inputTokens ?? estimate(requestChars(this.prompt, this.tools)),
      outputTokens: Math.max(this.counts.outputTokens ?? 0, estimate(this.outputChars)),
    }
  }
}
