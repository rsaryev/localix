/**
 * Drift guard between OUR error classifier and PI's issue-derived corpus.
 *
 * Pi run failures reach the app as PLAIN Error messages (the adapter flattens the
 * terminal assistant message), so `classifyAgentError`'s message-pattern lists are
 * the LIVE classifier for every pi run — while pi maintains its own battle-tested
 * lists (`ai/utils/retry.ts`, `ai/utils/overflow.ts`) that grow with upstream issue
 * reports. Two independently-maintained lists for the same decision WILL drift; a
 * transient error one side retries and the other calls fatal is a dead run.
 *
 * This test runs a shared corpus of real provider error strings through BOTH
 * classifiers and asserts ours COVERS pi's verdicts (ours may be broader — it also
 * handles statuses, retry-after, rate-limit flags — but never narrower on this
 * corpus). This package legitimately imports both sides; `packages/agent` must stay
 * vendor-free, so the guard lives here. When a pi re-vendor reclassifies any corpus
 * entry, this goes red instead of drifting silently.
 */
import { describe, expect, test } from 'bun:test'
import { isContextOverflow, isRetryableAssistantError } from '@earendil-works/pi-ai'
import type { AssistantMessage } from '@earendil-works/pi-ai'

import { classifyAgentError } from '@localixai/agent/agents'

function assistantError(errorMessage: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage,
    timestamp: 0,
  } as unknown as AssistantMessage
}

/** Real provider error strings, one per pattern family in pi's overflow corpus. */
const OVERFLOW_CORPUS = [
  'prompt is too long: 213462 tokens > 200000 maximum', // Anthropic
  '413 {"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}', // Anthropic 413
  'Your input exceeds the context window of this model', // OpenAI
  "Requested token count exceeds the model's maximum context length of 131072 tokens", // LiteLLM
  "Input length (265330) exceeds model's maximum context length (262144).", // OpenAI-compatible
  'The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)', // Google
  "This model's maximum prompt length is 131072 but the request contains 537812 tokens", // xAI
  'Please reduce the length of the messages or completion', // Groq
  "This endpoint's maximum context length is 200000 tokens. However, you requested about 300000 tokens", // OpenRouter
  'Input length 300000 exceeds the maximum allowed input length of 200000 tokens.', // Poolside
  "The input (300000 tokens) is longer than the model's context length (262144 tokens).", // Together
  'the request exceeds the available context size, try increasing it', // llama.cpp
  'prompt token count of 300000 exceeds the limit of 128000', // GitHub Copilot
  'invalid params, context window exceeds limit', // MiniMax
  'Your request exceeded model token limit: 262144 (requested: 300000)', // Kimi
  'Prompt contains 300000 tokens and 0 draft tokens, too large for model with 262144 maximum context length', // Mistral
  'Prompt has 300000 tokens, but the configured context size is 262144 tokens', // DS4
  'model_context_window_exceeded', // z.ai
  'prompt too long; exceeded max context length by 1000 tokens', // Ollama
  'context_length_exceeded', // generic
]

/** One representative string per pattern family in pi's retryable corpus. */
const RETRYABLE_CORPUS = [
  'Overloaded',
  'Too Many Requests',
  'Service Unavailable, please try again later',
  'Internal error encountered',
  'Provider returned error',
  'network error while fetching',
  'connection refused',
  'other side closed',
  'fetch failed',
  'upstream connect error or disconnect/reset before headers',
  'socket hang up',
  'The socket connection was closed unexpectedly',
  'Request timed out',
  'websocket closed with code 1006',
  'websocket error: unexpected close',
  'stream ended before message_stop',
  'stream ended before a terminal response event',
  'http2 request did not get a response',
  'You can retry your request, or contact us if the issue persists',
  'Please try your request again in a moment',
  'ResourceExhausted: rate limited by upstream',
]

/** Terminal quota/plan caps — pi refuses to retry these; we must not either. */
const LIMIT_CORPUS = [
  'GoUsageLimitError: usage limit reached',
  'FreeUsageLimitError',
  'Monthly usage limit reached. Enable available balance usage to continue.',
  'insufficient_quota: You exceeded your current quota',
  'out of budget for this billing period',
  'quota exceeded',
]

describe('classifier drift vs pi corpus', () => {
  test('every overflow shape pi detects routes to compaction in ours', () => {
    for (const message of OVERFLOW_CORPUS) {
      // Sanity: the corpus entry really is one pi recognizes.
      expect(isContextOverflow(assistantError(message)), `pi should detect: ${message}`).toBe(true)
      const ours = classifyAgentError(new Error(message))
      expect(ours.kind, `ours must route to compaction: ${message}`).toBe('context_overflow')
      expect(ours.shouldCompress).toBe(true)
    }
  })

  test('every transient fault pi would retry is retryable in ours', () => {
    for (const message of RETRYABLE_CORPUS) {
      expect(
        isRetryableAssistantError(assistantError(message)),
        `pi should retry: ${message}`,
      ).toBe(true)
      const ours = classifyAgentError(new Error(message))
      expect(ours.retryable, `ours must retry: ${message}`).toBe(true)
      expect(ours.kind, `a transient fault must not read as overflow: ${message}`).not.toBe(
        'context_overflow',
      )
    }
  })

  test('every quota/plan cap pi refuses to retry is terminal in ours too', () => {
    for (const message of LIMIT_CORPUS) {
      expect(
        isRetryableAssistantError(assistantError(message)),
        `pi should refuse: ${message}`,
      ).toBe(false)
      const ours = classifyAgentError(new Error(message))
      expect(ours.retryable, `ours must not hammer a cap: ${message}`).toBe(false)
      expect(ours.rateLimited, `a cap should carry the rateLimited flag: ${message}`).toBe(true)
    }
  })

  test('the overflow/throttle guard agrees with pi on the Bedrock trap', () => {
    // "Throttling error: Too many tokens, please wait" matches an overflow substring
    // but is a throttle — BOTH sides must classify it retryable, never compaction.
    const trap = 'Throttling error: Too many tokens, please wait before trying again.'
    expect(isContextOverflow(assistantError(trap))).toBe(false)
    const ours = classifyAgentError(new Error(trap))
    expect(ours.kind).toBe('fatal')
    expect(ours.retryable).toBe(true)
  })
})
