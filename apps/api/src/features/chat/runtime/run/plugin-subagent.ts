import type { DelegatePluginPorts } from '../../../agent-core/tools/delegate-plugin-agent'
import { workflowAgentRoute, type ChatModel } from '../../../agent-core/tools/workflow/agent-route'
import {
  adoptHookWorktree,
  type WorktreeHook,
} from '../../../agent-core/tools/workflow/hook-worktree'
import { createAgentWorktree } from '../../../agent-core/tools/workflow/worktree'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'
import type { SessionProvenance } from '../../session-provenance'
import { runAsPluginAgent } from './plugin-main-agent'

/**
 * A plugin's agents as subagent types in a chat run (`agent-core/tools/delegate-plugin-agent.ts`):
 * listed to the model beside `delegate`, lent to `delegate` with the chat's route and folder, and
 * applied to every run of a child created as one.
 */

/** The heading of the runtime-context section that lists the types. */
export const AGENT_TYPES_HEADING = '# Agent types'

/**
 * `# Agent types` — the enabled plugins' agents `delegate` can run a task as, each with when to
 * use it, as Claude Code lists its subagent types. A `state` section of the runtime context: it is
 * re-sent only when the list changes, and the cached prompt prefix never carries it.
 */
export function agentTypesSection(
  types: readonly Pick<LoadedPluginAgent, 'fullName' | 'description' | 'tools'>[],
): string | null {
  if (types.length === 0) return null
  return [
    AGENT_TYPES_HEADING,
    'Agent types `delegate` can hand a task to as `agent: "<type>"`: your `.claude/agents` files, the enabled plugins\' agents and the built-in read-only Explore and Plan (`general-purpose` is yourself). Each runs with its own instructions, tools and model, and sees only the task.',
    ...types.map(
      (agent) =>
        `- ${agent.fullName}: ${agent.description.trim() || 'No description.'}${
          agent.tools ? ` (tools: ${agent.tools.join(', ')})` : ''
        }`,
    ),
  ].join('\n')
}

/** What `delegate` needs for this run's plugin agents: the list, the chat's route, a worktree. */
export function delegatePluginPorts(input: {
  agents: readonly LoadedPluginAgent[]
  chatModel?: ChatModel
  catalog: readonly { id: string; providerId: string }[]
  /** The chat's folder: an isolated agent works in a worktree of its repository. */
  defaultCwd: string
  /** The conversation the worktrees are grouped under. */
  rootSessionId: string
  /** The run's WorktreeCreate hooks, which replace `git worktree add` when present (CC). */
  worktreeHook?: WorktreeHook
}): DelegatePluginPorts {
  const { chatModel, catalog } = input
  return {
    agents: () => input.agents,
    ...(chatModel
      ? { route: (asked) => workflowAgentRoute({ ...asked, chat: chatModel, catalog }) }
      : {}),
    isolate: async (name) => {
      const made = await input.worktreeHook?.(name)
      if (made) return adoptHookWorktree(made)
      return createAgentWorktree({ cwd: input.defaultCwd, name, group: input.rootSessionId })
    },
  }
}

/**
 * Run a child created as a plugin agent as that agent: its prompt is the run's identity and its
 * tool limits apply, on this run and every later one. A delegated child names its type, and so does
 * a `context: fork` skill's `agent:` — by `<plugin>:<name>`, or by a name only one enabled agent
 * has. Null when the session is not one, or when no enabled agent has that type — the child then
 * runs as the agent seated in it, and the log says so.
 */
export function applyPluginSubagent<Agent extends { instructions?: string | null }>(
  input: { agent: Agent; disabledTools: readonly string[] },
  provenance: SessionProvenance,
  agents: readonly LoadedPluginAgent[],
  warn: (message: string) => void = () => {},
): { agent: Agent; disabledTools: string[]; subagent: LoadedPluginAgent } | null {
  const type =
    provenance.kind === 'task-delegation' || provenance.kind === 'skill-fork'
      ? provenance.pluginAgent
      : undefined
  if (!type) return null
  const byName = agents.filter((agent) => agent.name === type)
  const subagent =
    agents.find((agent) => agent.fullName === type) ?? (byName.length === 1 ? byName[0] : undefined)
  if (!subagent) {
    warn(`plugin agent "${type}" is not enabled here; the child runs as its seated agent`)
    return null
  }
  return { ...runAsPluginAgent(input, subagent), subagent }
}

/** The workspace instruction files (`AGENTS.md`, `CLAUDE.md`) an `omitClaudeMd` agent runs without. */
const INSTRUCTION_FILE = /(^|[\\/])(AGENTS|CLAUDE)(\.local)?\.md$/

/** The context files a run as `subagent` reads: none of the instruction files with `omitClaudeMd`. */
export function contextFilesFor<File extends { path: string }>(
  files: readonly File[],
  subagent: Pick<LoadedPluginAgent, 'omitClaudeMd'> | null,
): File[] {
  return subagent?.omitClaudeMd
    ? files.filter((file) => !INSTRUCTION_FILE.test(file.path))
    : [...files]
}

/** The prompt cache a run as `subagent` asks for: `1h` the long-lived one, `5m` the default. */
export function promptCacheRetentionFor(
  subagent: Pick<LoadedPluginAgent, 'cacheTtl'> | null,
): 'short' | 'long' | undefined {
  if (subagent?.cacheTtl === '1h') return 'long'
  return subagent?.cacheTtl === '5m' ? 'short' : undefined
}
