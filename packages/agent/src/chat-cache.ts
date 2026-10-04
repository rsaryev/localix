import { browserHash, textEncoderByteLength } from './utils/hash'
import type { ChatCacheSnapshotPayload } from './chat-stream-types'

// ---- System prompt hash memoization -------------------------------------------
// The system prompt is constant for a session's lifetime, so we avoid recomputing
// its SHA-256 on every turn by caching the result keyed by the prompt string.
// We use a bounded Map (max 64 entries) so memory stays bounded even in
// multi-session server deployments.

const PROMPT_HASH_CACHE_MAX = 64
const promptHashCache = new Map<string, string>()

function cachedShortSha256(text: string): string {
  const hit = promptHashCache.get(text)
  if (hit !== undefined) return hit
  const hash = browserHash(text)
  // Evict the oldest entry when full (Map preserves insertion order).
  if (promptHashCache.size >= PROMPT_HASH_CACHE_MAX) {
    promptHashCache.delete(promptHashCache.keys().next().value!)
  }
  promptHashCache.set(text, hash)
  return hash
}

// ---- Snapshot ------------------------------------------------------------------

export function createChatCacheSnapshot(params: {
  providerId?: string
  modelId: string
  systemPrompt: string
  stablePrefix?: string
  dynamicSuffix?: string
  promptContext?: string | null
  providerOptions?: unknown
  toolNames?: readonly string[]
  messageCount: number
  hasSystemCacheBoundary?: boolean
  promptContextCacheTarget?: ChatCacheSnapshotPayload['promptContextCacheTarget']
}): ChatCacheSnapshotPayload {
  const stablePrefix = params.stablePrefix ?? params.systemPrompt
  const dynamicSuffix = params.dynamicSuffix ?? ''
  const promptContext = params.promptContext ?? ''
  const toolNames = [...(params.toolNames ?? [])].sort()

  return {
    providerId: params.providerId,
    modelId: params.modelId,
    // Use the memoized hash for the system prompt — it never changes within a session.
    systemPromptHash: cachedShortSha256(params.systemPrompt),
    stablePrefixHash: cachedShortSha256(stablePrefix),
    dynamicSuffixHash: dynamicSuffix ? browserHash(dynamicSuffix) : undefined,
    promptContextHash: promptContext ? browserHash(promptContext) : undefined,
    providerOptionsHash:
      params.providerOptions === undefined ? undefined : browserHash(params.providerOptions),
    toolNamesHash: browserHash(toolNames),
    systemPromptBytes: textEncoderByteLength(params.systemPrompt),
    stablePrefixBytes: textEncoderByteLength(stablePrefix),
    dynamicSuffixBytes: textEncoderByteLength(dynamicSuffix),
    promptContextBytes: textEncoderByteLength(promptContext),
    messageCount: params.messageCount,
    toolNames,
    hasSystemCacheBoundary: params.hasSystemCacheBoundary ?? false,
    promptContextCacheTarget: params.promptContextCacheTarget ?? params.providerId ?? 'none',
  }
}

// ---- Cache-stability guard ----------------------------------------------------
//
// The stable prefix is what the provider caches (`cache_control` boundary). If a
// per-turn-volatile token leaks ABOVE the split marker into that prefix, the cached
// bytes change every turn and the cache never hits — a silent, expensive regression.
// This is a DETECTOR only (never rewrites the hot zone). Tier-1 regex (fast, pure). NOTE: a date-only stamp (`YYYY-MM-DD`) is
// intentionally tolerated — the system prompt emits date-only, accepting at most a
// daily cache roll; only a token with finer (per-turn) churn is flagged.

export interface CacheVolatilityFinding {
  kind: 'timestamp' | 'epoch' | 'uuid' | 'hash' | 'jwt'
  /** The offending substring (clipped). */
  sample: string
  /** Character offset within the scanned text. */
  index: number
}

const VOLATILITY_PATTERNS: ReadonlyArray<{ kind: CacheVolatilityFinding['kind']; re: RegExp }> = [
  // ISO-8601 WITH a time component — per-second/minute churn (date-only is tolerated).
  { kind: 'timestamp', re: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/g },
  // Epoch MILLISECONDS — a raw `Date.now()`, which is the most direct way a per-turn
  // stamp reaches a prompt, and the shape an ISO pattern cannot see. 13 digits opening
  // with 1 or 2 spans years 2001-2286, so the range check is what keeps this specific
  // rather than "any long number"; a word boundary stops it matching inside a longer
  // digit run while still catching one embedded in an id (`run-1772585501101`).
  //
  // Epoch SECONDS are deliberately absent: at 10 digits they are indistinguishable
  // from an ordinary large integer, and this guard warns on every production turn, so
  // a false positive costs more than the missed case. Same reasoning as tolerating a
  // date-only stamp above — the guard flags churn it can name with confidence.
  { kind: 'epoch', re: /\b[12]\d{12}\b/g },
  { kind: 'uuid', re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi },
  { kind: 'jwt', re: /eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}/g },
  // md5/sha1/sha256 hex digests (word-bounded to limit false positives).
  { kind: 'hash', re: /\b[0-9a-f]{32}\b|\b[0-9a-f]{40}\b|\b[0-9a-f]{64}\b/gi },
]

/**
 * Scan a would-be-cached prefix for per-turn-volatile tokens that would bust the
 * prompt cache. Returns findings in document order (capped). Empty = cache-stable.
 */
export function detectCacheVolatility(
  text: string,
  opts: { max?: number } = {},
): CacheVolatilityFinding[] {
  const max = opts.max ?? 20
  const found: CacheVolatilityFinding[] = []
  for (const { kind, re } of VOLATILITY_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      found.push({ kind, sample: m[0].slice(0, 64), index: m.index })
      if (found.length >= max * VOLATILITY_PATTERNS.length) break
    }
  }
  return found.sort((a, b) => a.index - b.index).slice(0, max)
}

// ---- Prompt cache partitioning ------------------------------------------------
//
// Providers (Anthropic, OpenRouter w/ Anthropic models) cache the longest matching
// prefix of the prompt. To maximise cache-hit rate, split the system prompt into:
//
//   stableBase   — rules, persona, tool definitions, static context.
//                  Changes at most once per deploy. Costs cache-read tokens
//                  (~10x cheaper than input tokens on Anthropic).
//   dynamicSuffix — session-specific context (user profile, current date, active
//                   project). Changes per session — not worth caching.
//
// With this split, every turn pays cache-read tokens for the stable base and
// only input tokens for the dynamic suffix.

export interface PromptCachePartition {
  /** Stable content to be cached at the provider (changes rarely). */
  stableBase: string
  /** Dynamic content appended after the stable base (per-session). */
  dynamicSuffix: string
  /** Full combined prompt, ready to pass as systemPrompt. */
  full: string
}

/**
 * Split a system prompt string into a stable prefix (provider-cached) and a
 * dynamic suffix (session-specific, injected at runtime).
 *
 * The split is at the last occurrence of `splitMarker`. Everything before and
 * including the marker is the stable base; everything after is the dynamic suffix.
 *
 * @example
 * const { stableBase, dynamicSuffix } = partitionPromptForCache(
 *   systemPrompt,
 *   '# Runtime context',
 * )
 * // Pass stableBase to the provider's cache_control boundary,
 * // and stableBase + dynamicSuffix as the full system prompt.
 */
export function partitionPromptForCache(prompt: string, splitMarker: string): PromptCachePartition {
  const idx = prompt.lastIndexOf(splitMarker)
  if (idx === -1) {
    return { stableBase: prompt, dynamicSuffix: '', full: prompt }
  }
  const stableBase = prompt.slice(0, idx + splitMarker.length)
  const dynamicSuffix = prompt.slice(idx + splitMarker.length)
  return { stableBase, dynamicSuffix, full: prompt }
}

// Single source of truth for the stable/volatile split marker — see cache-marker.ts.
// Re-exported here so `@localixai/agent/chat-cache` consumers (the prompt assembler, the
// run-path splitter, the diagnostics partitioner) share the exact same string.
export { RUNTIME_CONTEXT_MARKER } from './cache-marker'
