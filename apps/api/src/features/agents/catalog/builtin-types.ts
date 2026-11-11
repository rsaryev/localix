import { DEFAULT_AGENT_NAME } from '@localixai/agent/agents'
import type { CatalogAgent } from './agent-file'

/**
 * What Localix adds to Claude Code's built-in subagents (the kit lists them, with Claude Code's
 * descriptions, tools and start context): the prompts they run on, as Claude Code's own are not
 * published, and that `general-purpose` and `claude` are the delegator itself. And Localix's own
 * main agent, `localix`, which is no Claude Code subagent: the main loop, not a type a task goes to.
 */
const PROMPTS: Readonly<Record<string, string>> = {
  'statusline-setup': [
    "You set up the user's status line. Read the settings file, then edit only its `statusLine` entry:",
    'a command that prints one line, and the padding it needs. Keep every other setting as it is.',
    'Say what you changed, and where.',
  ].join('\n'),
  'claude-code-guide': [
    'You answer questions about Claude Code, the Claude Agent SDK and the Claude API.',
    'Look the answer up in the current documentation rather than recalling it, and cite the page.',
    'You cannot change files. Say when the documentation does not answer the question.',
  ].join('\n'),
  Explore: [
    'You are a read-only search agent. Find what the task asks for in the codebase and report it.',
    'You cannot create, edit or delete files. Search broadly first, then read the relevant parts.',
    'Answer with the findings and the file paths (with line numbers) that support them.',
  ].join('\n'),
  Plan: [
    'You are a read-only planning agent. Study the code the task concerns and propose how to do it.',
    'You cannot create, edit or delete files. Report the steps, the files each touches, and the risks.',
  ].join('\n'),
}
const DELEGATORS = new Set(['general-purpose', 'claude'])

/** A built-in subagent as Localix runs it; any other agent as it is. */
export function localixBuiltin(agent: CatalogAgent): CatalogAgent {
  if (agent.source.kind !== 'builtin') return agent
  const { definition } = agent
  return {
    ...agent,
    definition: { ...definition, prompt: definition.prompt || (PROMPTS[agent.name] ?? '') },
    ...(DELEGATORS.has(agent.name) ? { self: true } : {}),
  }
}

/** Localix's main agent: what a chat runs as while the person has chosen no other. */
export const LOCALIX_AGENT: CatalogAgent = {
  name: DEFAULT_AGENT_NAME,
  ownName: DEFAULT_AGENT_NAME,
  source: { kind: 'builtin' },
  definition: {
    description: 'The general assistant: any task, directly or with a team.',
    prompt:
      'You are Localix Agent, a general-purpose assistant. Keep the user’s decisions with the user.',
  },
  extras: {},
  hooks: undefined,
  path: undefined,
  startsWith: { claudeMd: true, gitStatus: true },
  projectId: '',
  bodyHash: '',
}
