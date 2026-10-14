/**
 * Provider-neutral model contract for Edit Prediction. A narrow adapter sits on top
 * of the generic `@localixai/agent` `Provider` so the engine reasons about CAPABILITIES
 * and a NORMALIZED response (text + finish reason + retryability) instead of calling
 * `provider.complete` directly and re-deriving those every time.
 *
 * The engine negotiates: it reads `capabilities()` to pick the cache policy and
 * output-token budget, sends a `NormalizedModelRequest`, and reacts to the
 * `NormalizedModelResponse` finish reason — in particular it REJECTS a truncated
 * generation rather than parsing a half-written edit (the silent-truncation defect
 * class).
 */

import type { ReasoningEffort, Usage } from '@localixai/agent'

/** What a resolved model/provider can do for an edit-prediction request. */
export interface EditPredictionModelCapabilities {
  /** Native structured-output support. The v2 path is prompt-instructed JSON, so this
   *  is informational today — the engine does not require it. */
  structuredOutput: boolean
  /** Token-by-token streaming. Deferred capability — buffered only for now. */
  streaming: boolean
  /** Honors an `AbortSignal` mid-flight (all `@localixai/agent` providers do). */
  cancellation: boolean
  /** Prompt-cache tier the static system prefix can claim. */
  promptCaching: 'none' | 'ephemeral' | 'long'
  maxInputTokens?: number
  maxOutputTokens?: number
}

/** Why generation stopped, normalized across providers. `length` means the output
 * was TRUNCATED at the token budget — an untrustworthy, possibly half-written reply. */
export type EditPredictionFinishReason = 'stop' | 'length' | 'aborted' | 'error' | 'unknown'

/** A provider-neutral edit-prediction request. Provider-specific knobs are the
 * adapter's business, not the engine's. */
export interface NormalizedModelRequest {
  modelId: string
  systemPrompt: string
  userContent: string
  /** Overall token budget for the call. `outputTokens` caps generation; `inputTokens`
   *  is advisory context-window headroom. */
  budget: { inputTokens?: number; outputTokens: number }
  temperature: number
  reasoningEffort: ReasoningEffort
  /** Resolved from `capabilities().promptCaching` — the static system prefix's cache tier. */
  promptCaching: EditPredictionModelCapabilities['promptCaching']
}

/** A provider-neutral edit-prediction response. */
export interface NormalizedModelResponse {
  /** The model's raw reply text (assistant text content concatenated). */
  text: string
  usage: Usage | undefined
  finishReason: EditPredictionFinishReason
  /** True when the output was cut off at the token budget (`finishReason === 'length'`). */
  truncated: boolean
  /** Whether a transient failure (429/5xx/timeout) makes a single retry worthwhile.
   *  Only meaningful when the adapter throws — a returned response is not an error. */
  retryable?: boolean
  /** Provider-assigned request id, when the provider exposes one (diagnostics only). */
  providerRequestId?: string
}

/**
 * The narrow model seam the engine drives. `capabilities()` is synchronous and pure
 * (the engine calls it once per prediction); `predict()` performs the completion and
 * normalizes the reply, or throws — a thrown error is classified by the engine as
 * `cancelled`/`deadline_exceeded` (when the signal aborted) or `provider_error`.
 */
export interface EditPredictionModelAdapter {
  capabilities(): EditPredictionModelCapabilities
  predict(req: NormalizedModelRequest, signal: AbortSignal): Promise<NormalizedModelResponse>
}
