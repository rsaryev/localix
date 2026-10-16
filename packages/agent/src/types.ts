import type { z } from 'zod'

// ---- Primitives ----------------------------------------------------------------

export type Role = 'user' | 'assistant' | 'tool'

export interface TextContent {
  type: 'text'
  text: string
  textSignature?: string
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
  thinkingSignature?: string
  redacted?: boolean
}

export interface ImageContent {
  type: 'image'
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  data: string // base64
}

/**
 * A non-image binary document (PDF, etc.) carried inline as base64. Distinct from
 * `ImageContent` (`type:'image'`) so vision-only gating in transform-messages can
 * treat documents separately from images. Each wire serializes it to its
 * provider's document/attachment part.
 */
export interface FileContent {
  type: 'file'
  mediaType: string // e.g. 'application/pdf'
  data: string // base64
  filename?: string
}

export interface ToolCall {
  type: 'tool_call'
  id: string
  name: string
  arguments: unknown
  thoughtSignature?: string
}

export interface ToolResult {
  type: 'tool_result'
  toolCallId: string
  toolName: string
  content: string | Array<TextContent | ImageContent | FileContent>
  isError?: boolean
  details?: unknown
  /** Live-state snapshot key — older same-key results may be superseded in context. */
  supersedeKey?: string
}

// ---- Messages ------------------------------------------------------------------

export interface UserMessage {
  role: 'user'
  content: string | Array<TextContent | ImageContent | FileContent>
  timestamp: number
  /**
   * Prompt-cache anchor: marks the END of the request prefix that will be rebuilt
   * BYTE-IDENTICALLY on the next run (persisted history — no volatile runtime tail,
   * no this-run thinking). Explicit-breakpoint providers (Anthropic `cache_control`)
   * place an extra breakpoint here so the rebuilt-history prefix stays readable
   * across runs; without it the only matching entry is the system+tools segment and
   * the whole history is re-WRITTEN to cache every run (measured on a real session:
   * 10.5M cache-write tokens). Set once per run on the last stable history message.
   */
  cacheAnchor?: boolean
}

export interface AssistantMessage {
  role: 'assistant'
  content: Array<TextContent | ThinkingContent | ToolCall>
  api?: string
  provider?: string
  model: string
  responseModel?: string
  responseId?: string
  /**
   * The provider-native reasoning level this response was generated at, exactly as the provider
   * bound it. Opaque protocol state like a thinking signature: some providers bind signed
   * reasoning to the level it was produced at, so a replayed message must carry it back verbatim
   * or its reasoning is rejected (or silently dropped). Absent where the provider does not bind.
   */
  providerThinkingLevel?: string
  usage?: Usage
  stopReason?: StopReason
  errorMessage?: string
  diagnostics?: AssistantMessageDiagnostic[]
  /**
   * True generation timing measured at the raw provider stream, independent of
   * cosmetic stream-smoothing delays. `providerReadMs` is the wall time actually
   * spent awaiting provider chunks (real model time); `ttftMs` is time to first
   * content chunk; `toolGenMs` is provider time spent emitting tool-call args.
   * Absent for non-streaming providers.
   */
  genTimings?: GenTimings
  timestamp: number
  /** See {@link UserMessage.cacheAnchor}. */
  cacheAnchor?: boolean
}

/** Redacted provider/runtime diagnostic retained across runtime adapters and persistence. */
export interface AssistantMessageDiagnostic {
  type: string
  /** Adapter-neutral summary for diagnostics not backed by a thrown error. */
  message?: string
  /** Provider observation time. Older adapters may omit it. */
  timestamp?: number
  error?: {
    name?: string
    message: string
    stack?: string
    code?: string | number
  }
  details?: Record<string, unknown>
}

export interface GenTimings {
  /** Sum of time awaiting provider chunks — true model wall time (excludes smoothing). */
  providerReadMs: number
  /** Provider time until the first content chunk (real time-to-first-token). */
  ttftMs: number
  /** Provider time from the first tool-call chunk to stream end (tool-arg generation). */
  toolGenMs: number
}

export interface ToolResultMessage {
  role: 'tool'
  results: ToolResult[]
  toolCallId?: string
  toolName?: string
  content?: Array<TextContent | ImageContent | FileContent>
  isError?: boolean
  details?: unknown
  timestamp: number
  /** See {@link UserMessage.cacheAnchor}. */
  cacheAnchor?: boolean
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage

// ---- Metadata ------------------------------------------------------------------

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Subset of cacheWriteTokens created with one-hour retention. */
  cacheWrite1hTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  totalCost?: number
  /**
   * Provenance of `totalCost`: 'actual' = reported by the provider for the real
   * billed amount (e.g. OpenRouter usage.cost); 'estimated' = computed from the
   * static price catalog; 'subscription' = OAuth subscription plan (e.g. Claude
   * Pro/Max) — the value is a catalog-estimated API-equivalent, NOT metered spend.
   * Lets the UI/dashboard flag trustworthiness.
   */
  costSource?: 'actual' | 'estimated' | 'subscription'
  cost?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'error'
  | 'aborted'

// `minimal` sits BELOW `low` — the genuinely-lowest thinking a reasoning model
// accepts (GPT-5's `reasoning_effort:'minimal'`, Anthropic's smallest effort).
// `off` still means "no thinking where the model allows it"; `minimal` means
// "think as little as possible" on models that cannot be turned off.
export type ReasoningEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort
  label: string
  description: string
}> = [
  { value: 'off', label: 'Off', description: 'No chain-of-thought' },
  { value: 'minimal', label: 'Minimal', description: 'Least thinking the model allows' },
  { value: 'low', label: 'Low', description: 'Fast, lighter reasoning' },
  { value: 'medium', label: 'Medium', description: 'Balanced' },
  { value: 'high', label: 'High', description: 'Deep reasoning' },
  // Between `high` and `max`, because that is where providers put it: Claude Opus 4.7/4.8,
  // Sonnet 5 and Fable 5 map both, while the GPT-5.2–5.5 family maps `xhigh` and NOT `max`.
  // A model that supports neither gets the nearest level it does support (pi clamps).
  { value: 'xhigh', label: 'X-High', description: 'Highest native level on models that have it' },
  { value: 'max', label: 'Max', description: 'Maximum effort' },
]

export function isReasoningEffort(v: string | null): v is ReasoningEffort {
  return v !== null && REASONING_EFFORT_OPTIONS.some((o) => o.value === v)
}

/**
 * What a run thinks at when nobody has said otherwise. Matches pi's `DEFAULT_THINKING_LEVEL`.
 *
 * One constant because the fallback appeared at four seams (session creation, the model picker's
 * row, the reasoning control, the composer chip) and each carried its own literal — which is how
 * the picker could paint a level no new session would actually run at.
 *
 * `off` is deliberately not it, and is never a default anywhere: a model that cannot reason
 * already resolves to no reasoning at request time (`preflight.resolveReasoningEffort`), so
 * `off` in stored state only ever means the PERSON asked for none.
 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium'

// ---- Tools ---------------------------------------------------------------------

export interface Tool<TInput = unknown> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
}

export function tool<TInput>(definition: Tool<TInput>): Tool<TInput> {
  return definition
}

// ---- Message helpers -----------------------------------------------------------

export function userMessage(content: string): UserMessage {
  return { role: 'user', content, timestamp: Date.now() }
}

export function getTextContent(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('')
}

export function getThinkingContent(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is ThinkingContent => c.type === 'thinking')
    .map((c) => c.thinking)
    .join('')
}

export function getToolCalls(msg: AssistantMessage): ToolCall[] {
  return msg.content.filter((c): c is ToolCall => c.type === 'tool_call')
}

export function toolResultMessage(results: ToolResult[]): ToolResultMessage {
  return { role: 'tool', results, timestamp: Date.now() }
}
