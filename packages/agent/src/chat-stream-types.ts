// Chat-stream data-part TYPE surface: the typed-channel registry plus every
// payload interface carried over the chat SSE/data-part transport. Split out of
// chat-stream.ts so that file owns nothing but the barrel; the `create*` builders
// live in chat-stream-parts.ts and the `extract*` validators in chat-stream-extract.ts.

export const CHAT_STREAM_DATA_TYPES = {
  status: 'data-status',
  error: 'data-chat-error',
  providerConnect: 'data-provider-connect',
  usage: 'data-usage',
  cacheDiagnostics: 'data-cache-diagnostics',
  contextCompacted: 'data-context-compacted',
  contextWindow: 'data-context-window',
  contextAttempt: 'data-context-attempt',
} as const

export type ChatStreamDataType =
  (typeof CHAT_STREAM_DATA_TYPES)[keyof typeof CHAT_STREAM_DATA_TYPES]

export type ChatDataPart<TType extends ChatStreamDataType = ChatStreamDataType, TData = unknown> = {
  type: TType
  data: TData
  transient?: boolean
}

export type ChatStatusScope = 'tool' | 'post-processing' | 'provider' | (string & {})
export type ChatStatusPhase = 'started' | 'running' | 'completed'

export interface ChatStatusPayload {
  scope: ChatStatusScope
  phase: ChatStatusPhase
  message: string
}

export type ChatErrorAction = 'show-provider-connect' | (string & {})

export interface ChatErrorPayload {
  code: string
  title: string
  message: string
  action?: ChatErrorAction
}

export interface ChatProviderConnectPayload {
  title: string
  message: string
}

export interface ChatUsageTotals {
  totalTokens?: number
  totalCost?: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  // Cache-creation (write) tokens — billed at a premium and previously dropped,
  // which undercounted session cost by ~5x on fresh sessions.
  cacheWriteTokens?: number
  /** Subset of cacheWriteTokens created with one-hour retention. */
  cacheWrite1hTokens?: number
  // Reasoning/thinking tokens (subset of output, billed as output). Surfaced for visibility.
  reasoningTokens?: number
}

export interface ChatUsagePayload extends ChatUsageTotals {
  usage?: ChatUsageTotals
  /**
   * Context size (input + output tokens) of the LAST completed model request of
   * the run this payload belongs to. The top-level token fields are SUMS over all
   * turns of the run (a 30-turn tool run re-bills the context every turn), so they
   * massively overstate "how big is this conversation" — this field is the real
   * per-request figure, the anchor for the next turn's context estimate and checkpoint decision.
   */
  contextTokens?: number
  /**
   * The LAST completed model request of the run, by kind: `inputTokens` is the whole input of
   * that request (uncached, cache reads and cache writes together), as the provider measured it.
   * What a Claude Code status line reads as `context_window.current_usage`.
   */
  lastRequest?: ChatLastRequestUsage
  /** Static request identity that makes `contextTokens` safe to reuse next run. */
  contextIdentity?: ChatContextAnchorIdentity
  isSummary?: boolean
  // 'actual' = provider-reported billed cost; 'estimated' = computed from the
  // price catalog; 'subscription' = OAuth plan (API-equivalent estimate, not
  // metered spend). Drives the trust badge in the usage UI/dashboard.
  costSource?: 'actual' | 'estimated' | 'subscription'
}

export interface ChatLastRequestUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ChatContextAnchorIdentity {
  providerId: string
  modelId: string
  boundaryId: string
  systemPromptHash: string
  toolSchemaHash: string
  fixedOverheadTokens: number
}

export interface ChatCacheSnapshotPayload {
  providerId?: string
  modelId: string
  systemPromptHash: string
  stablePrefixHash: string
  dynamicSuffixHash?: string
  promptContextHash?: string
  providerOptionsHash?: string
  toolNamesHash: string
  systemPromptBytes: number
  stablePrefixBytes: number
  dynamicSuffixBytes: number
  promptContextBytes: number
  messageCount: number
  toolNames: string[]
  hasSystemCacheBoundary: boolean
  promptContextCacheTarget: string
}

export interface ChatCacheDiagnosticsPayload {
  snapshot: ChatCacheSnapshotPayload
  previous?: { changed: string[] }
}

export interface ChatContextWindowPayload {
  sessionId: string
  /** Physical provider/model context capacity. */
  fullWindowTokens: number
  /** Optional stricter host policy capacity. */
  policyWindowTokens?: number
  /** The whole-request ceiling: the policy window minus the response reserve. */
  ceilingTokens: number
  /** Where a context checkpoint rewrites the model's view (a share of the ceiling). */
  checkpointAtTokens: number
  reservedTokens: number
  /** Latest measured or estimated resident context, when one exists. */
  activeTokens?: number
  /** Whether activeTokens came from provider usage or a local estimate. */
  activeTokensKind?: ChatContextTokenKind
}

export type ChatContextTokenKind = 'measured' | 'estimated' | 'unknown'
export type ChatContextAttemptOutcome = 'running' | 'succeeded' | 'failed' | 'unknown'
export type ChatContextAttemptStage = 'preflight' | 'provider' | 'unknown'

/**
 * Outcome of the newest assistant attempt, intentionally separate from usage:
 * local preflight failures have no provider request and therefore no usage.
 */
export interface ChatContextAttemptPayload {
  outcome: ChatContextAttemptOutcome
  stage: ChatContextAttemptStage
  contextTokens?: number
  tokenKind: ChatContextTokenKind
}
