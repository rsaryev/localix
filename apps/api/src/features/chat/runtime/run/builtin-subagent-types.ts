import type { LoadedPluginAgent } from '../../../plugins/loader-contract'

/**
 * Claude Code's built-in read-only subagent types, `Explore` and `Plan`, as `delegate` types
 * (sub-agents.md, "Built-in subagents"). A task delegated as one, or a skill's `context: fork` with
 * `agent: Explore`, runs as the delegating agent with these instructions and without the tools that
 * write files. Like Claude Code, they start without the project's instruction files: the task has
 * to say what it needs. `general-purpose` and `claude` are the delegator itself
 * (`agent-core/tools/delegate-plugin-agent.ts`).
 *
 * An enabled plugin agent of the same bare name replaces the built-in, as a user or project agent
 * named `Explore` replaces Claude Code's.
 */
const READ_ONLY = ['write', 'edit'] as const

export const BUILTIN_SUBAGENT_TYPES: readonly LoadedPluginAgent[] = [
  {
    pluginName: 'builtin',
    name: 'Explore',
    fullName: 'Explore',
    label: 'Explore',
    description:
      'Fast read-only codebase search: find files, search code, answer questions about the codebase. Say how thorough to be.',
    prompt: [
      'You are a read-only search agent. Find what the task asks for in the codebase and report it.',
      'You cannot create, edit or delete files. Search broadly first, then read the relevant parts.',
      'Answer with the findings and the file paths (with line numbers) that support them.',
    ].join('\n'),
    disallowedTools: READ_ONLY,
  },
  {
    pluginName: 'builtin',
    name: 'Plan',
    fullName: 'Plan',
    label: 'Plan',
    description:
      'Read-only research for planning: gathers the context a plan needs and proposes the steps, files and risks.',
    prompt: [
      'You are a read-only planning agent. Study the code the task concerns and propose how to do it.',
      'You cannot create, edit or delete files. Report the steps, the files each touches, and the risks.',
    ].join('\n'),
    disallowedTools: READ_ONLY,
  },
]

/** Names of the built-in types, which start without the project's instruction files. */
export const OMIT_INSTRUCTIONS_TYPES: ReadonlySet<string> = new Set(
  BUILTIN_SUBAGENT_TYPES.map((t) => t.fullName),
)

/** The run's subagent types: the enabled plugins' agents, then each built-in none of them replaces. */
export function withBuiltinSubagentTypes(
  agents: readonly LoadedPluginAgent[] | undefined,
): LoadedPluginAgent[] {
  const own = agents ?? []
  const taken = new Set(own.map((agent) => agent.name.toLowerCase()))
  return [...own, ...BUILTIN_SUBAGENT_TYPES.filter((t) => !taken.has(t.name.toLowerCase()))]
}
