import type { AssistantMessage } from '..'
import type { HumanInLoopRequestBase, HumanInLoopResponseBase } from './human-in-loop'
import type { AgentMessage, AgentMessageOrigin, AgentToolResult, ToolGateProvenance } from './types'

/**
 * Why `agentLoop` stopped. Only `completed` and `tool_terminate` are ordinary
 * endings; every other value means the run was CUT SHORT with work possibly left
 * undone. It used to live only on the OTel span, so a host had no way to tell a
 * finished agent from a braked one and the user saw a run that simply trailed off.
 */
export type AgentStopReason =
  /** The model produced a final message with no tool calls. */
  | 'completed'
  /** A tool returned `terminate: true` (sleep, a game move that ends the turn). */
  | 'tool_terminate'
  /**
   * Burned every turn in `maxTurns` without finishing. Under the current loop this
   * is ALSO the only in-loop no-progress brake left: the home-grown loop's guard
   * reasons (consecutive_tool_errors / repeated_tool_calls / oscillating_tool_calls /
   * content_loop / exploration_stall / output_cap_stall) were deleted with that loop
   * — the loop has no such guards, so the union no longer advertises stops that can never
   * happen. Anti-thrash now lives in the host's stuck-run breaker
   * (`apps/api/src/features/agent-core/tools/stuck-run-breaker.ts`).
   */
  | 'max_turns'
  /** The caller's `AbortSignal` fired. */
  | 'aborted'
  /** The provider stream failed; an `error` event was emitted alongside. */
  | 'stream_error'

/**
 * One assistant-part update. `delta` is always the newly appended provider
 * fragment (empty for lifecycle-only start/end frames); cumulative text and the
 * authoritative final message deliberately do not travel on `message_update`.
 */
export type AgentMessageDelta =
  | {
      kind: 'text'
      phase: 'start' | 'delta' | 'end'
      contentIndex: number
      delta: string
      origin: AgentMessageOrigin
      textSignature?: string
    }
  | {
      kind: 'reasoning'
      phase: 'start' | 'delta' | 'end'
      contentIndex: number
      delta: string
      origin: AgentMessageOrigin
      thinkingSignature?: string
      redacted?: boolean
    }
  | {
      kind: 'tool_call'
      phase: 'start' | 'delta' | 'end'
      contentIndex: number
      delta: string
      id: string
      name: string
      input: unknown
      origin: AgentMessageOrigin
      thoughtSignature?: string
    }

export type AgentEvent =
  | { type: 'agent_start'; timestamp: number }
  | {
      type: 'agent_end'
      timestamp: number
      stopReason?: AgentStopReason
    }
  | { type: 'turn_start'; turnIndex: number }
  | {
      type: 'turn_end'
      turnIndex: number
      message: AssistantMessage
      toolResults: AgentToolResult[]
    }
  | { type: 'message_start'; message: AgentMessage }
  | { type: 'message_update'; delta: AgentMessageDelta }
  | { type: 'message_end'; message: AgentMessage }
  | {
      type: 'tool_execution_start'
      toolCallId: string
      toolName: string
      input: unknown
    }
  | { type: 'tool_execution_update'; toolCallId: string; details: unknown }
  | {
      type: 'human_in_loop_request'
      toolCallId: string
      toolName: string
      request: HumanInLoopRequestBase
    }
  | {
      type: 'human_in_loop_response'
      toolCallId: string
      toolName: string
      response: HumanInLoopResponseBase
    }
  | {
      type: 'tool_execution_end'
      toolCallId: string
      toolName: string
      result: AgentToolResult
      provenance?: ToolGateProvenance
    }
  | { type: 'error'; error: Error }
