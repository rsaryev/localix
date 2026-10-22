/**
 * Default {@link EditPredictionModelAdapter} — a thin wrap of the generic
 * `@localixai/agent` `Provider`. It performs the completion with the exact options the
 * pre-split service used (`temperature`, `maxTokens`, `reasoningEffort`, the static
 * prefix's `cacheRetention`, the abort `signal`) and NORMALIZES the reply into a
 * provider-neutral `NormalizedModelResponse` (text + finish reason + truncation).
 *
 * Behavior note: the outgoing `provider.complete` call is pinned by the assertions in
 * `predict-next-edit.test.ts` (`capturedOpts`), not by a golden baseline — the
 * differential golden test this used to cite no longer exists.
 */

import type { AssistantMessage, StopReason } from '@localixai/agent'
import type { LanguageModel } from '@localixai/agent/runtime'
import type {
  EditPredictionFinishReason,
  EditPredictionModelAdapter,
  EditPredictionModelCapabilities,
  NormalizedModelRequest,
  NormalizedModelResponse,
} from './contracts'

/** Extract plain text from an assistant message's content blocks. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text',
    )
    .map((b) => b.text)
    .join('')
}

/** Map a provider `StopReason` to the normalized edit-prediction finish reason. */
export function normalizeFinishReason(stop: StopReason | undefined): EditPredictionFinishReason {
  switch (stop) {
    case 'max_tokens':
      return 'length'
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_use':
      return 'stop'
    case 'aborted':
      return 'aborted'
    case 'error':
      return 'error'
    case undefined:
      return 'unknown'
  }
}

/**
 * Whether a thrown provider error is worth a single retry within budget: transient
 * transport failures (HTTP 429 / 5xx / timeouts / network resets) are retryable; a
 * 4xx (other than 429), an abort, or a parse/shape error is NOT. Best-effort and
 * duck-typed — the engine never imports a concrete provider's error class.
 */
export function classifyRetryable(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const status =
      (error as { status?: unknown; statusCode?: unknown }).status ??
      (error as { statusCode?: unknown }).statusCode
    if (typeof status === 'number') return status === 429 || (status >= 500 && status <= 599)
    const name = (error as { name?: unknown }).name
    if (name === 'AbortError') return false
    const code = (error as { code?: unknown }).code
    if (
      typeof code === 'string' &&
      /^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND)$/.test(code)
    ) {
      return true
    }
  }
  const rawMessage = (error as { message?: unknown } | null | undefined)?.message
  const message =
    typeof rawMessage === 'string' ? rawMessage : typeof error === 'string' ? error : ''
  // Text is the last resort for errors that carry no structure. A bare 3-digit number
  // is not a status ("500 files", "got 503 rows"): it counts only at the head of the message
  // or after `status`/`HTTP`, the way providers print a status line.
  return (
    /\b(too many requests|rate limit|timed? ?out|timeout|econnreset|network error|fetch failed)\b/i.test(
      message,
    ) || /(?:^|\b(?:status|http)\b[\s:/\d.]*?)(?:429|5\d\d)\b/i.test(message.trimStart())
  )
}

/** Build the default provider-backed adapter for a resolved (provider, model). */
export function createLanguageModelAdapter(
  model: LanguageModel,
  _modelId: string,
): EditPredictionModelAdapter {
  return {
    capabilities(): EditPredictionModelCapabilities {
      // The v2 path is prompt-instructed JSON (not native structured output), and every
      // `@localixai/agent` provider honors an AbortSignal.
      //
      // Prompt caching is deliberately OFF, which reverses the pre-split default. Two
      // measured facts kill it for this shape of request:
      //
      //  1. The v2 system prefix is ~323 tokens. Every provider minimum for a cacheable
      //     prefix is higher (512 on the newest Anthropic models, 1024-4096 elsewhere),
      //     so a breakpoint on the static prefix can never produce a read. Padding a
      //     prompt to clear a cache minimum is not a real option.
      //  2. The provider does not confine the breakpoint to that prefix — it also marks
      //     the last conversation message (the provider's
      //     cache-control placement). Here that message is the per-keystroke file window: ~1.3k tokens
      //     for a 60-line file and ~21k once windowing saturates. That prefix DOES clear
      //     the minimum, so retention wrote a cache entry whose tail changes on every
      //     request — at the 1h write premium (2x input), against a hit rate of ~0.
      //
      // A cache write is only worth its premium when the same prefix is read back (twice
      // over at 5m, three times at 1h). An edit prediction never reads its own prefix
      // again, so retention here was a pure surcharge on the feature's dominant cost.
      return {
        structuredOutput: false,
        streaming: true,
        cancellation: true,
        promptCaching: 'none',
      }
    },
    async predict(
      req: NormalizedModelRequest,
      signal: AbortSignal,
    ): Promise<NormalizedModelResponse> {
      const cacheRetention =
        req.promptCaching === 'long' ? 'long' : req.promptCaching === 'ephemeral' ? 'short' : 'none'
      const message: AssistantMessage = await model.complete({
        systemPrompt: req.systemPrompt,
        messages: [{ role: 'user', content: req.userContent, timestamp: Date.now() }],
        temperature: req.temperature,
        maxOutputTokens: req.budget.outputTokens,
        reasoningEffort: req.reasoningEffort,
        cacheRetention,
        signal,
      })
      const finishReason = normalizeFinishReason(message.stopReason)
      return {
        text: messageText(message.content),
        usage: message.usage,
        finishReason,
        truncated: finishReason === 'length',
        providerRequestId: message.responseId,
      }
    },
  }
}
