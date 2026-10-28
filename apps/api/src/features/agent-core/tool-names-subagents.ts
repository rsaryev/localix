import { CHAT_ONLY, type BuiltinToolDefinition } from './tool-exposure'

/**
 * Claude Code's three subagent tools, spread into `BUILTIN_TOOL_CATALOG`. None takes
 * a model or an effort: the person sets each agent's, and a fork runs on its parent's.
 */
export const SUBAGENT_TOOL_CATALOG = {
  Agent: {
    name: 'Agent',
    label: 'Agent',
    description:
      'Start a subagent in a child session: yourself, an agent from the directory, or a fork.',
    category: 'automation',
    // Subagents are a root chat's: the child it creates may not start its own.
    exposure: CHAT_ONLY,
  },
  SendMessage: {
    name: 'SendMessage',
    label: 'Send message',
    description:
      'Message a subagent you started, or, inside a subagent, the agent that started it.',
    category: 'automation',
    // Claude Code removes it from a subagent's inherited tools, a fork's included; an agent file
    // that lists it keeps its line to the agent that started it. An unattended run has neither.
    exposure: { chat: 'default', subagent: 'opt-in', automation: 'never' },
  },
  TaskStop: {
    name: 'TaskStop',
    label: 'Stop task',
    description: 'Stop a running subagent or a background shell job.',
    category: 'automation',
    exposure: CHAT_ONLY,
  },
} as const satisfies Record<string, BuiltinToolDefinition>
