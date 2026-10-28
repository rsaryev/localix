import { TOOL } from '../../agent-core/tool-names'
import { DEFAULT_AGENT_NAME } from '@localixai/agent/agents'
import type { CatalogAgent } from './agent-file'

/**
 * The built-in agent types, as catalog entries with a `builtin` source (sub-agents.md, "Built-in
 * subagents"). No other code names them: a file or plugin agent of the same name replaces one, as
 * a user agent named `Explore` replaces Claude Code's.
 *
 * - `localix` is the main loop, not a type a task is handed to.
 * - `general-purpose` and `claude` are the delegator itself, with every tool.
 * - `statusline-setup` and `claude-code-guide` have the tool lists Claude Code gives them.
 * - `Explore` and `Plan` are read-only and start without the project's instruction files.
 */
const READ_ONLY = [TOOL.Write, TOOL.Edit] as const

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
  ...fields,
})

export const BUILTIN_AGENT_TYPES: readonly CatalogAgent[] = [
  builtin(DEFAULT_AGENT_NAME, {
    description: 'The general assistant: any task, directly or with a team.',
    prompt:
      'You are Localix Agent, a general-purpose assistant. Keep the user’s decisions with the user.',
  }),
  builtin('general-purpose', {
    description:
      'General-purpose agent for researching complex questions, searching for code and executing multi-step tasks.',
    prompt: '',
    self: true,
  }),
  builtin('claude', {
    description: 'Catch-all for any task that does not fit a more specific agent.',
    prompt: '',
    self: true,
  }),
  builtin('statusline-setup', {
    description: "Configure the user's Claude Code status line setting.",
    prompt: [
      "You set up the user's status line. Read the settings file, then edit only its `statusLine` entry:",
      'a command that prints one line, and the padding it needs. Keep every other setting as it is.',
      'Say what you changed, and where.',
    ].join('\n'),
    tools: [TOOL.Read, TOOL.Edit],
    omitClaudeMd: true,
  }),
  builtin('claude-code-guide', {
    description:
      'Answers questions about Claude Code (features, hooks, slash commands, MCP servers, settings) and the Claude API and Agent SDK, from the current documentation.',
    prompt: [
      'You answer questions about Claude Code, the Claude Agent SDK and the Claude API.',
      'Look the answer up in the current documentation rather than recalling it, and cite the page.',
      'You cannot change files. Say when the documentation does not answer the question.',
    ].join('\n'),
    tools: [TOOL.Bash, TOOL.Read, TOOL.Research],
    omitClaudeMd: true,
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
