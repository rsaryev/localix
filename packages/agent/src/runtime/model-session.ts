/**
 * MODEL SESSION: one model, one credential, one run — the seam between the agent loop and the
 * layer that talks to providers.
 *
 * The loop knows conversations, tools and turns; it does not know a wire protocol, a provider, a
 * cache header or an SDK. Model access knows exactly those and nothing about turns. One request
 * here is ONE assistant response: the loop decides whether another follows.
 */
import type { AgentMessageDelta } from '../agents'
import type { AssistantMessage, Message, ReasoningEffort } from '../types'
import type { RuntimeModelRef } from './model'

/** A tool as the MODEL sees it: its name, what it is for, and the JSON Schema of its input. */
export interface ModelToolDeclaration {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ModelTurnRequest {
  systemPrompt: string
  /** The conversation the model reads, in order. Only conversational roles reach a provider. */
  messages: readonly Message[]
  tools: readonly ModelToolDeclaration[]
  reasoningEffort?: ReasoningEffort
  maxOutputTokens?: number
  /** Sampling temperature, for auxiliary completions; a provider that refuses one never sees it. */
  temperature?: number
  signal: AbortSignal
}

/**
 * One assistant response while it streams.
 *
 * Iterating yields each part as it grows; `message` settles with the final response and NEVER
 * rejects for the provider's sake: a failed request is a message with `stopReason: 'error'`
 * (its cause in `errorMessage`, and the provider's response facts on `failure`), a cancelled
 * one is `stopReason: 'aborted'`. A turn whose deltas nobody reads still settles.
 */
export interface ModelTurn extends AsyncIterable<AgentMessageDelta> {
  readonly message: Promise<AssistantMessage>
  /**
   * The error behind a `stopReason: 'error'` message, with whatever the provider said about it
   * (status, `Retry-After`) attached — what the host classifies a failed run by. Undefined
   * until `message` settles, and for every response that did not fail.
   */
  readonly failure: Error | undefined
}

/**
 * A model bound to its credential for the length of one run. Created by model access, consumed
 * by the agent loop. Holds no conversation: every turn carries the whole request.
 */
export interface ModelSession {
  readonly ref: RuntimeModelRef
  turn(request: ModelTurnRequest): ModelTurn
}
