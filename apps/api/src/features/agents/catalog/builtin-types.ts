import { DEFAULT_AGENT_HANDLE } from '@localixai/agent/agents'
import type { CatalogAgent } from './agent-file'

/**
 * The built-in agent types, as catalog entries with a `builtin` source (sub-agents.md, "Built-in
 * subagents"). No other code names them: a file or plugin agent of the same name replaces one, as
 * a user agent named `Explore` replaces Claude Code's.
 *
 * - `localix` is the main loop, not a type a task is handed to.
 * - `general-purpose` (also `claude`) is the delegator itself, with every tool.
 * - `Explore` and `Plan` are read-only and start without the project's instruction files.
 */
const READ_ONLY = ['write', 'edit'] as const

const builtin = (
  name: string,
  fields: Pick<CatalogAgent, 'description' | 'prompt'> & Partial<CatalogAgent>,
): CatalogAgent => ({
  pluginName: 'builtin',
  name,
  fullName: name,
  label: name,
  source: 'builtin',
  projectId: '',
  path: '',
  bodyHash: '',
  localix: { priority: 0 },
  ...fields,
})

export const BUILTIN_AGENT_TYPES: readonly CatalogAgent[] = [
  builtin(DEFAULT_AGENT_HANDLE, {
    description: 'The general assistant: any task, directly or with a team.',
    prompt:
      'You are Localix Agent, a general-purpose assistant. Keep the user’s decisions with the user.',
    localix: { priority: 2 },
  }),
  builtin('general-purpose', {
    description:
      'General-purpose agent for researching complex questions, searching for code and executing multi-step tasks.',
    prompt: '',
    self: true,
    aliases: ['claude'],
  }),
  builtin('Explore', {
    description:
      'Fast read-only codebase search: find files, search code, answer questions about the codebase. Say how thorough to be.',
    prompt: [
      'You are a read-only search agent. Find what the task asks for in the codebase and report it.',
      'You cannot create, edit or delete files. Search broadly first, then read the relevant parts.',
      'Answer with the findings and the file paths (with line numbers) that support them.',
    ].join('\n'),
    disallowedTools: READ_ONLY,
    omitClaudeMd: true,
  }),
  builtin('Plan', {
    description:
      'Read-only research for planning: gathers the context a plan needs and proposes the steps, files and risks.',
    prompt: [
      'You are a read-only planning agent. Study the code the task concerns and propose how to do it.',
      'You cannot create, edit or delete files. Report the steps, the files each touches, and the risks.',
    ].join('\n'),
    disallowedTools: READ_ONLY,
    omitClaudeMd: true,
  }),
]
