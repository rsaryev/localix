import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import {
  conversationControlRequestSchema,
  type ConversationControlRequest,
} from '../conversation-control-request'
import { TOOL } from '../tool-names'

export interface ConversationControlPort {
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
  }>
}

const CONVERSATION_CONTROL_CLASS: CallClass = { effect: 'session' }

/** Atomic membership update and terminal scheduling for a multi-agent conversation turn. */
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
      port.membership === 'fixed'
        ? 'Name current teammates by handle or ID. The parent assigned this team: membership cannot change.'
        : 'Agents are named by handle (with or without @) or ID. invite/remove change membership only, and apply before next is checked — to start an invited colleague, name them in next too.',
    ].join(' '),
    inputSchema:
      port.membership === 'fixed'
        ? conversationControlRequestSchema.omit({ invite: true, remove: true }).strict()
        : conversationControlRequestSchema,
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
      })
      const changes = [
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
