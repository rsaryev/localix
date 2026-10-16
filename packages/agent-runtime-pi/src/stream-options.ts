/**
 * The per-request STREAM OPTIONS a run hands pi: the host's request metadata merged over pi's
 * own, with two adapter decisions folded in — the prompt-cache TTL derived from the host's
 * idle gap, and the response capture that keeps a provider refusal's headers recoverable.
 *
 * Split from `runtime.ts` because it is a different concern from the loop: every rule here
 * is about ONE request's options, and each is pinned by its own test
 * (`cache-retention.test.ts`, the `onResponse` cases in `runtime.test.ts`).
 */
import type { ModelsSimpleStreamOptions } from '@earendil-works/pi-ai'

import { pickCacheRetention, type PiCacheRetention } from './cache-retention'

/** The subset of the runtime's tuning that rides on every request. */
export interface PiRequestTuning {
  maxRetries?: number
  maxRetryDelayMs?: number
  timeoutMs?: number
}

/** Snapshot the shared transport settings without erasing Pi defaults with undefined. */
export function requestTuning(options: PiRequestTuning): PiRequestTuning {
  return {
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.maxRetryDelayMs !== undefined ? { maxRetryDelayMs: options.maxRetryDelayMs } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  }
}

/**
 * A provider refusal worth remembering: pi flattens every provider failure to a message
 * string before it leaves the vendor boundary, so the response that caused it — and with it
 * `Retry-After` and the rate-limit reset headers — is otherwise unrecoverable. pi's own
 * `onResponse` hook is the only channel that still carries them.
 *
 * Only refusals (status >= 400) are kept, and a SUCCESS CLEARS the previous one. Both halves
 * matter:
 *   - a successful Anthropic response also carries `anthropic-ratelimit-*-reset`, and treating
 *     that as "wait this long" would be wrong — it says when a window replenishes, not to back
 *     off;
 *   - without the clear, a refusal pi RECOVERED from would outlive it. pi's codex transport
 *     retries a 429 internally and then succeeds, and the loop calls the stream function once
 *     per turn, so a turn-1 `retry-after: 60` would still be attached when turn 20 died of an
 *     idle timeout — reporting a rate-limit window for a failure that is not one. Found by
 *     review: the guarantee this comment used to imply was not the one the code made.
 *
 * REACH, stated precisely, because it is narrower than "pi exposes response headers": only
 * `openai-codex-responses` and `pi-messages` call `onResponse` BEFORE checking `.ok`, so only
 * they deliver a refusal. `anthropic-messages`, `openai-completions`, `openai-responses`,
 * `azure-openai-responses` and `bedrock-converse-stream` call it only after a successful
 * create/stream open — a 429 raised inside the SDK dies with the `APIError` pi discards, so its
 * headers never arrive. `google-generative-ai`, `google-vertex`, `mistral-conversations` and
 * `cloudflare` never call it at all. For every one of those the classifier is left with the
 * delay stated in the error text, or with its own invented floor.
 */
function captureProviderRefusal(
  capture: { last?: { status: number; headers: Record<string, string> } },
  options: ModelsSimpleStreamOptions | undefined,
): ModelsSimpleStreamOptions['onResponse'] {
  const upstream = options?.onResponse
  return async (response, model) => {
    capture.last =
      response.status >= 400 ? { status: response.status, headers: response.headers } : undefined
    await upstream?.(response, model)
  }
}

/** `{ cacheRetention }` when the idle gap was measured, `{}` when it was not. */
function cacheRetentionOverride(idleMs: number | undefined): { cacheRetention?: PiCacheRetention } {
  const retention = pickCacheRetention(idleMs)
  return retention === undefined ? {} : { cacheRetention: retention }
}

/** Merge host-owned request metadata after Pi's per-request options. */
export function withPiRunStreamOptions(
  options: ModelsSimpleStreamOptions | undefined,
  input: { sessionId: string; promptCacheIdleMs?: number },
  runtime: PiRequestTuning,
  capture?: { last?: { status: number; headers: Record<string, string> } },
): ModelsSimpleStreamOptions {
  return {
    ...options,
    // Wrapped, never replaced: an upstream per-request `onResponse` must still run.
    ...(capture ? { onResponse: captureProviderRefusal(capture, options) } : {}),
    // Spread-order tripwire: assigning `undefined` outright would CLOBBER an
    // upstream per-request value with "unset" — merge host overrides only when
    // the host actually set them.
    // The host reports the idle gap; the TTL that gap is worth is this adapter's call.
    ...cacheRetentionOverride(input.promptCacheIdleMs),
    ...requestTuning(runtime),
    sessionId: input.sessionId,
  }
}
