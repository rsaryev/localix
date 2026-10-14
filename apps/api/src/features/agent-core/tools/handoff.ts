import { defineAgentTool, type CallClass } from '@localixai/agent/agents'
import { z } from 'zod'

import { TOOL } from '../tool-names'

/** What the host made of the handles one `handoff` call named. */
export interface HandoffOutcome {
  /** Canonical handles that will answer once this turn's reply is written. */
  handed: string[]
  /** Named but neither present nor invitable: not saved. */
  unknown: string[]
  /** Everyone who can be handed the floor now, for the correction. */
  available: string[]
}

/** Bound by the host to the conversation and the speaking agent. */
export interface HandoffPort {
  hand(handles: string[]): Promise<HandoffOutcome>
}

const HANDOFF_CLASS: CallClass = { effect: 'session' }

const handoffInputSchema = z.strictObject({
  to: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(8)
    .describe('Handles of the participants who must act now, in the order they answer.'),
})
type HandoffInput = z.infer<typeof handoffInputSchema>

/**
 * The one way a participant gives a colleague the floor.
 *
 * An `@handle` in a reply used to do it, so a name written to refer to someone (or to say it was
 * NOT assigning them) woke them like an assignment, and two agents passed a finished task back
 * and forth until the hop limit stopped them. Now the intent is a typed call: `@handle` in prose
 * is only a link. The call does not end the turn: the reply written this turn is the brief.
 */
export function createHandoffTool(port: HandoffPort) {
  return defineAgentTool<HandoffInput>({
    name: TOOL.handoff,
    label: 'Handoff',
    activeVerb: 'Handing off',
    presentation: { transcript: 'hidden' },
    description:
      'Give colleagues the floor after this turn: each handle answers once, in order, reading your reply as its assignment. ' +
      'Write the assignment in your reply (scope, inputs, evidence expected). Not needed to report back or to ask the user; an @handle of a participant already here assigns nothing.',
    inputSchema: handoffInputSchema,
    mutates: true,
    classify: () => HANDOFF_CLASS,
    executionMode: 'sequential',
    async execute(_toolCallId, input) {
      const { handed, unknown, available } = await port.hand(input.to)
      const available_ = available.length ? available.map((h) => `@${h}`).join(', ') : 'nobody'
      if (unknown.length) {
        return {
          content: `${handed.length ? `Handed to ${handed.map((h) => `@${h}`).join(', ')}. ` : ''}Unknown handles: ${unknown.map((h) => `@${h}`).join(', ')}. Available: ${available_}.`,
          ...(handed.length ? {} : { isError: true }),
        }
      }
      return {
        content: `Handed to ${handed.map((h) => `@${h}`).join(', ')} once you finish this reply. Write their assignment now.`,
      }
    },
  })
}
