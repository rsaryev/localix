import { randomUUID } from 'node:crypto'

import type {
  AgentMessage,
  AgentToolExecutionContext,
  AsyncToolRegistry,
} from '@localixai/agent/agents'
import type { SteeringBoundary } from '@localixai/agent'

import type { RunnerDeps } from '../agent-runner-types'

export function buildRuntimeToolContext(input: {
  deps: RunnerDeps
  userId: string
  sessionId: string
  /** The participant this run speaks as — what a tool records as the actor. */
  speaker?: { agentId: string; handle: string; role: 'leader' | 'member' | 'solo' }
  asyncRegistry: AsyncToolRegistry
  scratchDir: string
  /** See {@link AgentToolExecutionContext.interactive} — computed by isHitlReachable. */
  interactive: boolean
}): AgentToolExecutionContext {
  const { deps, userId, sessionId } = input
  let commandSequence = 0
  return {
    humanInLoop: deps.hitlRegistry.controller,
    asyncRegistry: input.asyncRegistry,
    interactive: input.interactive,
    ...(deps.sanitizeToolResult
      ? { sanitizeResult: (result) => deps.sanitizeToolResult!(userId, result) }
      : {}),
    ...(deps.sanitizeToolError
      ? { sanitizeError: (error: unknown) => deps.sanitizeToolError!(userId, error) }
      : {}),
    ...(deps.sanitizeToolInput
      ? { sanitizeInput: (value: unknown) => deps.sanitizeToolInput!(userId, value) }
      : {}),
    session: {
      id: sessionId,
      scratchDir: input.scratchDir,
      ...(input.speaker ? { speaker: input.speaker } : {}),
      emitCommand: (plugin, channel, payload) =>
        deps.streamRegistry.publish(userId, sessionId, {
          type: 'plugin.command',
          sessionId,
          plugin,
          channel,
          payload,
          commandId: randomUUID(),
          seq: ++commandSequence,
        }),
      ...(deps.pluginCommands
        ? {
            emitCommandWithReply: (
              plugin: string,
              channel: string,
              payload: unknown,
              timeoutMs?: number,
            ) =>
              deps.pluginCommands!.send({
                userId,
                sessionId,
                plugin,
                channel,
                payload,
                seq: ++commandSequence,
                timeoutMs,
              }),
          }
        : {}),
    },
  }
}

export function buildRuntimeSteering(input: {
  takeUserMessages?: (boundary?: SteeringBoundary) => Promise<string[]>
}): ((boundary?: SteeringBoundary) => Promise<AgentMessage[]>) | undefined {
  const { takeUserMessages } = input
  if (!takeUserMessages) return undefined
  return async (boundary) =>
    (await takeUserMessages(boundary)).map(
      (content): AgentMessage => ({ role: 'user', content, timestamp: Date.now() }),
    )
}
