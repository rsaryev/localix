import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolExecutionContext,
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '../agents'

export * from './auth'
export * from './engine'
export * from './model'

import type { RuntimeCredential, RuntimeCredentialStore } from './auth'
import type { RuntimeModelRef } from './model'
import type { AssistantMessage, Message, ReasoningEffort } from '../types'

/** Provider-independent request for a single buffered model completion. */
export interface LanguageModelRequest {
  systemPrompt: string
  messages: readonly Message[]
  signal?: AbortSignal
  temperature?: number
  maxOutputTokens?: number
  reasoningEffort?: ReasoningEffort
  cacheRetention?: 'none' | 'short' | 'long'
  sessionId?: string
}

/**
 * Narrow application port for auxiliary LLM calls (summary, title, judge, classifier).
 * Provider transports, auth refresh, retries and response parsing remain adapter-owned.
 */
export interface LanguageModel {
  readonly ref: RuntimeModelRef
  complete(request: LanguageModelRequest): Promise<AssistantMessage>
}

export interface LanguageModelFactory {
  create(
    model: RuntimeModelRef,
    credential: RuntimeCredential,
    credentialStore?: RuntimeCredentialStore,
  ): LanguageModel
}

export interface RuntimeContextPolicy {
  transform(messages: readonly AgentMessage[], signal: AbortSignal): Promise<AgentMessage[]>
}

/** The last settled tool turn, if the runtime is between its tools and the next model sample. */
export interface SteeringBoundary {
  completedToolTurnIndex?: number
}

export interface AgentRuntimeRunInput {
  sessionId: string
  messages: readonly AgentMessage[]
  systemPrompt: string
  model: RuntimeModelRef
  credential: RuntimeCredential
  /**
   * Durable store already scoped to the selected host connection. The
   * credential snapshot is used as a fallback; OAuth refreshes are persisted
   * through the store's serialized `modify` operation.
   */
  credentialStore?: RuntimeCredentialStore
  reasoningEffort?: ReasoningEffort
  maxOutputTokens?: number
  /**
   * How long this session sat idle before this turn, in milliseconds — a host FACT, not a
   * cache setting. Whether that gap is worth a longer (and dearer) cache write depends on the
   * provider's TTLs and price list, so the adapter decides; a host that names a TTL is writing
   * one provider's cost model into a neutral port. Absent means "no idle measurement": the
   * adapter keeps its own default.
   */
  promptCacheIdleMs?: number
  maxTurns?: number
  tools: readonly AgentTool[]
  /**
   * Local implementations eligible for dispatch. Defaults to `tools`; adapters may
   * override this when the model-visible schemas are a deferred subset.
   */
  dispatchTools?: readonly AgentTool[]
  toolExecutionContext?: AgentToolExecutionContext
  signal?: AbortSignal
  contextPolicy?: RuntimeContextPolicy
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>
  afterToolCall?: (
    context: AfterToolCallContext,
    signal: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>
  takeSteering?: (boundary?: SteeringBoundary) => AgentMessage[] | Promise<AgentMessage[]>
  /** Messages required by a host protocol before a run may finish naturally. */
  takeFollowUp?: () => AgentMessage[] | Promise<AgentMessage[]>
  /**
   * Host reasons to end the run at a turn boundary, evaluated after the adapter's own
   * budget rule; the first to fire names itself in {@link AgentRuntimeResult.stoppedBy}.
   *
   * The predicate takes no arguments on purpose. A condition that needed the adapter's turn
   * ledger or the provider's message would be adapter-shaped and belongs in the adapter's
   * own list — what belongs here is host state the host already tracks, such as a run-scoped
   * counter that has seen enough.
   */
  stopWhen?: readonly { name: string; shouldStop: () => boolean | Promise<boolean> }[]
}

export interface AgentRuntimeResult {
  messages: AgentMessage[]
  terminal: 'completed' | 'aborted' | 'failed'
  /**
   * Name of the adapter stop condition that ended the loop at a turn boundary, when one
   * fired. Diagnostics only — `terminal` stays the source of truth for how the run ended.
   */
  stoppedBy?: string
  error?: Error
}

/**
 * One run is both an ordered event stream and a terminal result. Implementations
 * must settle `result` exactly once, including setup failures and cancellation.
 */
export interface AgentRuntimeRun extends AsyncIterable<AgentEvent> {
  readonly result: Promise<AgentRuntimeResult>
  abort(reason?: string): void
}

/** The only interface application code uses to start an agent engine. */
export interface AgentRuntime {
  /** Persisted with every run so stored entries remain decodable after adapter upgrades. */
  readonly adapter: { id: string; version: string }
  run(input: AgentRuntimeRunInput): AgentRuntimeRun
  /**
   * Release adapter-owned resources whose lifetime is tied to a durable host
   * session (for example transport affinity, cached connections, or continuation
   * state). The host calls this only after the session's active run has settled.
   */
  disposeSession(sessionId: string): Promise<void> | void
}
export * from './lifecycle'
