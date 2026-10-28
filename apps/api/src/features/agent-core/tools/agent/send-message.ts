import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { TOOL } from '../../tool-names'
import { messageChild, type AgentControlPorts, type ToolAnswer } from './agent-control'

/**
 * `SendMessage` — Claude Code's line between an agent and its subagents, both ways.
 *
 * From the agent that started them it amends a subagent by its id or name: a running one
 * reads it at its next step, a finished one runs again with everything it knew and reports again.
 * From inside a subagent, `to: "main"` reaches the agent that started it WHILE the subagent keeps
 * working: a question only the parent can answer, a finding it needs now. That message joins the
 * parent's running turn after its next completed tool step, or opens a turn when it is idle.
 *
 * A run holds the half it has: a conversation its children, a child its parent.
 */
export interface ParentLine {
  /** One call is one delivery, keyed by its tool call. */
  send: (text: string, toolCallId: string) => Promise<void>
}

export interface SendMessagePorts {
  children?: AgentControlPorts
  parent?: ParentLine
}

/** The one name Claude Code gives a subagent for the agent above it (sub-agents.md). */
const PARENT_NAME = 'main'

const inputSchema = z
  .object({
    to: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('A subagent you started, by its id or name; inside a subagent, "main".'),
    message: z.string().trim().min(1).max(8000),
    summary: z.string().trim().max(120).optional().describe('A 5-10 word preview.'),
  })
  .strict()
type SendMessageInput = z.infer<typeof inputSchema>

const SEND: CallClass = { effect: 'session' }

const namesParent = (to: string) => to.trim() === PARENT_NAME

export function createSendMessageTool(ports: SendMessagePorts) {
  return defineAgentTool<SendMessageInput>({
    name: TOOL.SendMessage,
    label: 'Send message',
    activeVerb: 'Sending a message',
    description: [
      'Message a subagent you started, by its id or name: a running one reads it at its next step; a finished one runs again with everything it knew and replies again. Prefer it to a new Agent for a follow-up.',
      'Inside a subagent, to:"main" reaches the agent that started you while you keep working — for a question only it can answer or a finding it needs now; your final reply already goes to it.',
    ].join(' '),
    inputSchema,
    mutates: true,
    executionMode: 'parallel',
    classify: () => SEND,
    async execute(toolCallId, input): Promise<ToolAnswer> {
      const { parent, children } = ports
      if (parent && namesParent(input.to)) {
        await parent.send(input.message, toolCallId)
        return {
          content: `Sent to ${PARENT_NAME}. Keep working on what does not need its answer. If nothing is left until it answers, end your turn with a line saying what you are waiting for: its answer arrives as a message and you continue then. Do not wait with a tool.`,
        }
      }
      if (children) return messageChild(children, input.to, input.message)
      return {
        content: parent
          ? `You can message only the agent that started you: to:"main".`
          : 'You have no subagents to message.',
        isError: true,
      }
    },
  })
}
