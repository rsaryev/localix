import type { AgentTool } from '@localixai/agent/agents'

import type { StoredMessagePayload } from '../../../../db'
import { captureForkSeed } from '../../../agent-core/fork-seed'
import type { RunProfile } from '../../../agent-core/run-shape'
import type { ForkRoute } from '../../../agent-core/tools/task-delegation-contracts'
import type { ForkLiveRun } from './fork-port'

/**
 * What a run offers a fork of itself: the request it is sending, read when `Agent` forks.
 *
 * Every field is read at the call, not at the run's start, because the row in flight and its id
 * move with the run; the seed is built only then, since it copies every tool's schema.
 */
export function createForkLiveRun(input: {
  /** Resolves once the event handler has recorded the call in the row (`createRecordedCalls`). */
  recorded: (toolCallId: string) => Promise<void>
  route: ForkRoute
  currentRowId: () => string
  currentPayload: () => StoredMessagePayload
  systemPrompt: string
  tools: readonly AgentTool[]
  toolNames: readonly string[]
  profile: RunProfile
  /** The prompt cache key the request is sent with (a fork is sent with this one, too). */
  cacheSessionId: string
  retention?: 'short' | 'long'
}): ForkLiveRun {
  return {
    recorded: input.recorded,
    route: input.route,
    currentRowId: input.currentRowId,
    currentPayload: input.currentPayload,
    captureSeed: () =>
      captureForkSeed({
        systemPrompt: input.systemPrompt,
        tools: input.tools,
        cacheSessionId: input.cacheSessionId,
        toolNames: input.toolNames,
        profile: input.profile,
        ...(input.retention ? { retention: input.retention } : {}),
      }),
  }
}

/**
 * Which tool calls the run's event handler has written into the row in flight.
 *
 * The loop announces `tool_execution_start` and goes on to execute the tool; the host's handler
 * consumes the same events from a buffer, a little behind. `Agent` can therefore run before the
 * handler has stored the assistant message that carries the call, and a fork made then would copy a
 * row without it. The handler notes each start once it is done with it, and a fork waits for its
 * own call.
 */
export function createRecordedCalls() {
  const seen = new Set<string>()
  const waiting = new Map<string, Array<() => void>>()
  return {
    note(toolCallId: string): void {
      seen.add(toolCallId)
      for (const release of waiting.get(toolCallId) ?? []) release()
      waiting.delete(toolCallId)
    },
    when(toolCallId: string, signal?: AbortSignal): Promise<void> {
      if (seen.has(toolCallId)) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const release = () => {
          signal?.removeEventListener('abort', stopped)
          resolve()
        }
        const stopped = () => {
          waiting.set(
            toolCallId,
            (waiting.get(toolCallId) ?? []).filter((entry) => entry !== release),
          )
          reject(new Error('The run was stopped before the call was recorded'))
        }
        waiting.set(toolCallId, [...(waiting.get(toolCallId) ?? []), release])
        if (signal?.aborted) stopped()
        else signal?.addEventListener('abort', stopped, { once: true })
      })
    },
  }
}
