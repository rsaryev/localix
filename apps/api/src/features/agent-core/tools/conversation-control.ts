import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import {
  conversationControlRequestSchema,
  type ConversationControlRequest,
} from '../conversation-control-request'
import { TOOL } from '../tool-names'

export interface ConversationControlPort {
  /** Root chats can change their topic, including a fixed chat with one participant. */
  canChangeTopic?: boolean
  /** A delegated team's membership belongs to its parent; only next-speaker scheduling is offered. */
  membership?: 'fixed'
  finish(
    toolCallId: string,
    request: ConversationControlRequest,
  ): Promise<{
    invited: string[]
    removed: string[]
    next: string[]
    /** Why nobody was queued even though `next` named someone (the handoff chain's bound). */
    stopped?: string
    topic?: { title: string; goal: string; previousTopicSummary: string }
  }>
}

const CONVERSATION_CONTROL_CLASS: CallClass = { effect: 'session' }

/** Terminal scheduling, membership and shared topic control for a conversation turn. */
export function createConversationControlTool(port: ConversationControlPort) {
  return defineAgentTool<ConversationControlRequest>({
    name: TOOL.conversation_control,
    label: 'Conversation control',
    activeVerb: 'Updating conversation',
    presentation: { transcript: 'hidden' },
    // WHEN to call it and whom to schedule is the prompt's "# Conversation turn control"; this
    // says what one call does. Both used to carry the whole contract.
    description: [
      'End this turn and choose who answers next. It is terminal: write your public reply or handoff first.',
      ...(port.canChangeTopic
        ? [
            "Only the leader or sole participant may change topic. topic saves title, goal and previousTopicSummary together and starts a fresh history: all messages, tool history and checkpoints through this turn leave every participant's context. Only the saved summary carries the previous topic into the system prompt. Preserve important decisions, constraints, verified results and unfinished work, including relevant inherited summary. Private tool histories stay private. To continue the new goal yourself, put your own handle in next: allowed only with topic. Use next:[] if nobody needs a turn.",
          ]
        : []),
      port.membership === 'fixed'
        ? 'Name current participants by handle or ID. This conversation has fixed membership.'
        : 'Agents are named by handle (with or without @) or ID. invite/remove change membership only, and apply before next is checked — to start an invited colleague, name them in next too.',
    ].join(' '),
    inputSchema: conversationControlRequestSchema
      .omit({
        ...(port.membership === 'fixed' ? ({ invite: true, remove: true } as const) : {}),
        ...(!port.canChangeTopic ? ({ topic: true } as const) : {}),
      })
      .strict(),
    // Membership and the next speaker are this conversation's own state — a plan session must
    // still be able to hand the turn on, which the static `mutates` alone would read as external.
    mutates: true,
    classify: () => CONVERSATION_CONTROL_CLASS,
    executionMode: 'sequential',
    async execute(toolCallId, input) {
      const result = await port.finish(toolCallId, {
        next: [...new Set(input.next)],
        ...(input.invite ? { invite: [...new Set(input.invite)] } : {}),
        ...(input.remove ? { remove: [...new Set(input.remove)] } : {}),
        ...(input.topic ? { topic: input.topic } : {}),
      })
      const changes = [
        ...(result.topic
          ? [
              `Topic changed: ${result.topic.title}. Goal: ${result.topic.goal}. Prior context saved.`,
            ]
          : []),
        ...(result.invited.length ? [`Invited: ${result.invited.join(', ')}.`] : []),
        ...(result.removed.length ? [`Removed: ${result.removed.join(', ')}.`] : []),
        result.stopped ??
          (result.next.length
            ? `Queued: ${result.next.join(', ')}.`
            : 'No additional replies queued.'),
      ]
      return { content: changes.join(' '), terminate: true as const }
    },
  })
}
