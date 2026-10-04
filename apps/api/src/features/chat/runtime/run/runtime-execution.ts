import { randomUUID } from 'node:crypto'

import type {
  AgentMessage,
  AgentToolExecutionContext,
  AsyncToolRegistry,
} from '@localixai/agent/agents'
import type { SteeringBoundary } from '@localixai/agent'

import { TOOL } from '../../../agent-core/tool-names'
import type { RunnerDeps } from '../agent-runner-types'

export function buildRuntimeToolContext(input: {
  deps: RunnerDeps
  userId: string
  sessionId: string
  /** The participant this run speaks as — what a tool records as the actor. */
  speaker?: { agentId: string; handle: string }
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

/**
 * ONE answer to "must this turn end with conversation_control?", read by the repair follow-up
 * and by the terminal check alike. It used to be two: the follow-up was wired only for chat
 * sessions while the terminal check threw for ANY session with two members, so a non-chat
 * multi-member run was failed for skipping a tool nobody offered it. The answer comes from the
 * membership snapshot the run started with and from the tools the run actually holds; a
 * participant invited mid-turn takes part from the next turn.
 */
export function requiresConversationControl(
  memberCount: number,
  runTools: readonly { name: string }[],
): boolean {
  return memberCount > 1 && runTools.some((tool) => tool.name === TOOL.conversation_control)
}

/** Give a model two repair turns, then let the host reject the invalid terminal result. */
export function buildRequiredConversationControlFollowUp(
  isCompleted: () => boolean,
  onReminder?: () => void,
): () => Promise<AgentMessage[]> {
  let reminders = 0
  return async () => {
    if (isCompleted() || reminders >= 2) return []
    reminders += 1
    onReminder?.()
    return [
      {
        role: 'user',
        content:
          'Runtime protocol: call conversation_control exactly once now. Do not repeat or revise your public response. Pass next with only the colleagues whose replies you need, or next: [] to queue nobody.',
        timestamp: Date.now(),
      },
    ]
  }
}
