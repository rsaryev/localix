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
    'Plugin agents `delegate` can hand a task to as `agent: "<type>"`. Each runs with its own instructions, tools and model, and sees only the task.',
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
 * tool limits apply, on this run and every later one. Null when the session is not one, or when its
 * plugin is no longer enabled here — the child then runs as the agent seated in it, and the log
 * says so.
 */
export function applyPluginSubagent<Agent extends { instructions?: string | null }>(
  input: { agent: Agent; disabledTools: readonly string[] },
  provenance: SessionProvenance,
  agents: readonly LoadedPluginAgent[],
  warn: (message: string) => void = () => {},
): { agent: Agent; disabledTools: string[]; subagent: LoadedPluginAgent } | null {
  const type = provenance.kind === 'task-delegation' ? provenance.pluginAgent : undefined
  if (!type) return null
  const subagent = agents.find((agent) => agent.fullName === type)
  if (!subagent) {
    warn(`plugin agent "${type}" is not enabled here; the child runs as its seated agent`)
    return null
  }
  return { ...runAsPluginAgent(input, subagent), subagent }
}
