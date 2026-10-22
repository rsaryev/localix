import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolExecutionContext,
  AgentToolResult,
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '../agents'

export * from './auth'
export * from './engine'
export * from './local-models'
export * from './model'
export * from './model-session'
export * from './model-steps'
export * from './scripts'

import type { RuntimeCredential, RuntimeCredentialStore } from './auth'
import type { ModelStepHook } from './model-steps'
import type { RuntimeModelRef } from './model'
import type { AssistantMessage, Message, ReasoningEffort, Usage } from '../types'

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

/** One question a decision model answers with a pick among `criteria`'s keys. */
export interface DecisionChoiceQuestion {
  type: 'choice'
  instructions: string
  /** Option key → what the option means. */
  criteria: Record<string, string>
}

/** One question a decision model answers with the probability that its statement is true. */
export interface DecisionBoolQuestion {
  type: 'bool'
  instructions: string
  criteria: { true: string; false: string }
}

export type DecisionQuestion = DecisionChoiceQuestion | DecisionBoolQuestion

/**
 * A typed decision over structured state, for models whose output is `decisions` (OpenRouter's
 * System One protocol): no text, one answer per question with its probabilities. Every question
 * reads the same state and is answered in the same pass.
 */
export interface DecisionRequest {
  state: Record<string, unknown>
  questions: Record<string, DecisionQuestion>
  signal?: AbortSignal
}

export interface DecisionChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
}

export interface DecisionBoolAnswer {
  type: 'bool'
  probability: number
}

export type DecisionAnswer = DecisionChoiceAnswer | DecisionBoolAnswer

export interface DecisionResult {
  answers: Record<string, DecisionAnswer>
  usage?: Usage
}

/**
 * Narrow application port for auxiliary LLM calls (summary, title, judge, classifier).
 * Provider transports, auth refresh, retries and response parsing remain adapter-owned.
 */
export interface LanguageModel {
  readonly ref: RuntimeModelRef
  complete(request: LanguageModelRequest): Promise<AssistantMessage>
  /** Present when the adapter can run decision models; rejects when the model is not one. */
  decide?(request: DecisionRequest): Promise<DecisionResult>
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
  /** Last completed turn, including a response with no tool calls. */
  completedTurnIndex?: number
  completedToolTurnIndex?: number
}

/** One response's tool calls, each with the result the model will read. */
export interface ToolBatchContext {
  calls: readonly {
    toolCallId: string
    toolName: string
    input: unknown
    result: AgentToolResult
  }[]
}

export interface ToolBatchVerdict {
  /** Delivered to the model before its next request, once. */
  messages?: AgentMessage[]
  /** End the run before the next request; the name is reported as `stoppedBy`. */
  stop?: string
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
  /**
   * Every call of one response has settled, before the next model request. The host may add
   * messages the model reads first, or end the run here (`stop` names the reason, reported as
   * {@link AgentRuntimeResult.stoppedBy}). Not asked when the batch ended the run itself.
   */
  afterToolBatch?: (
    batch: ToolBatchContext,
    signal: AbortSignal,
  ) => Promise<ToolBatchVerdict | undefined>
  takeSteering?: (boundary?: SteeringBoundary) => AgentMessage[] | Promise<AgentMessage[]>
  /**
   * Is a message waiting that {@link takeSteering} would deliver? Asked before each tool call of
   * a response starts; true returns that call and the rest unrun, so the message reaches the
   * model first instead of after the whole batch. Calls already running finish.
   */
  shouldDeferToolCalls?: () => boolean | Promise<boolean>
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
  /**
   * Around each model request of the run (`model-steps.ts`): the host observes the response,
   * sends the request on another model of the run's provider or with another effort, or answers
   * it without sending.
   */
  modelStep?: ModelStepHook
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
