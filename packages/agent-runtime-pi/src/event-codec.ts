import type { AgentEvent as PiAgentEvent } from '@earendil-works/pi-agent-core'

import type { AgentEvent, AgentToolResult } from '@localixai/agent/agents'

import {
  fromPiAssistant,
  fromPiMessage,
  mapAssistantDelta,
  requirePiAssistant,
  toolResultFromPi,
} from './message-codec'
import { isConversationalPiMessage } from './pi-transcript'

export interface PiTurnState {
  index: number
  terminated: boolean
  /** Termination votes for the current Pi tool batch; only an all-true batch terminates. */
  toolTerminations?: boolean[]
  maxTurns?: number
  /** True only when the budget prevented a required follow-up provider turn. */
  budgetExhausted?: boolean
  terminalStopReason?: 'aborted' | 'stream_error'
}

export function mapEvent(
  event: PiAgentEvent,
  turn: PiTurnState,
  completedTools: Map<string, AgentToolResult> = new Map(),
): AgentEvent[] {
  switch (event.type) {
    case 'agent_start':
      return [{ type: 'agent_start', timestamp: Date.now() }]
    case 'agent_end':
      return [
        {
          type: 'agent_end',
          timestamp: Date.now(),
          stopReason: turn.terminated
            ? 'tool_terminate'
            : turn.terminalStopReason
              ? turn.terminalStopReason
              : turn.budgetExhausted
                ? 'max_turns'
                : 'completed',
        },
      ]
    case 'turn_start':
      turn.toolTerminations = []
      return [{ type: 'turn_start', turnIndex: turn.index++ }]
    case 'turn_end':
      turn.terminated =
        (turn.toolTerminations?.length ?? 0) > 0 &&
        turn.toolTerminations!.every((terminate) => terminate)
      return [
        {
          type: 'turn_end',
          turnIndex: Math.max(0, turn.index - 1),
          message: fromPiAssistant(requirePiAssistant(event.message)),
          toolResults: event.toolResults.map((result) => ({
            ...toolResultFromPi(result),
            isError: result.isError,
          })),
        },
      ]
    // pi's own system messages (the prompt, the per-turn tool loadout) are not host
    // messages: they have no engine-neutral counterpart and pi re-derives them, so they
    // are not surfaced as transcript events.
    case 'message_start':
      return isConversationalPiMessage(event.message)
        ? [{ type: 'message_start', message: fromPiMessage(event.message) }]
        : []
    case 'message_end': {
      if (!isConversationalPiMessage(event.message)) return []
      if (event.message.role === 'assistant') {
        if (event.message.stopReason === 'aborted') turn.terminalStopReason = 'aborted'
        else if (event.message.stopReason === 'error') turn.terminalStopReason = 'stream_error'
      }
      return [{ type: 'message_end', message: fromPiMessage(event.message) }]
    }
    case 'message_update': {
      const delta = mapAssistantDelta(event.assistantMessageEvent)
      return delta ? [{ type: 'message_update', delta }] : []
    }
    case 'tool_execution_start':
      return [
        {
          type: 'tool_execution_start',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.args,
        },
      ]
    case 'tool_execution_update':
      return [
        {
          type: 'tool_execution_update',
          toolCallId: event.toolCallId,
          details: event.partialResult.details,
        },
      ]
    case 'tool_execution_end': {
      const completed = completedTools.get(event.toolCallId)
      completedTools.delete(event.toolCallId)
      const piResult = toolResultFromPi(event.result)
      const result: AgentToolResult = completed
        ? {
            ...piResult,
            ...completed,
            details: completed.details ?? piResult.details,
          }
        : piResult
      // Pi's batch contract is ALL, not ANY: one terminating call beside one normal
      // call must continue so the model can consume the normal result.
      const terminations = turn.toolTerminations ?? (turn.toolTerminations = [])
      terminations.push(event.result.terminate === true)
      // One terminal event per call, failed or not. A failure used to be announced twice —
      // `tool_execution_error` and then `tool_execution_end` with the same failed result — and
      // every consumer ignored the first: the result already says `isError`, and the error
      // payload rides on it. Two names for one fact is a grammar the next adapter has to copy.
      return [
        {
          type: 'tool_execution_end',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.isError ? { ...result, isError: true } : result,
          ...(completed?.gateProvenance ? { provenance: completed.gateProvenance } : {}),
        },
      ]
    }
  }
}
