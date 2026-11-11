import type { AgentLaunchPorts } from '../../../agent-core/tools/agent/agent-type'
import type { TaskAgentType } from '../../../agent-core/tools/task-delegation-contracts'
import type { AgentModelChoice } from '../../../agent-core/agent-model-route'
import {
  adoptHookWorktree,
  type WorktreeHook,
} from '../../../agent-core/tools/workflow/hook-worktree'
import { createAgentWorktree } from '../../../agent-core/tools/workflow/worktree'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'
import {
  agentToolsRefusal,
  subagentModelRoute,
  type NamedTool,
  type SubagentModelContext,
} from '../../../plugins/kit'
import { runAsPluginAgent } from './plugin-main-agent'

/**
 * What a run takes from the agent it runs as (`applyCatalogAgent`), and what it lends
 * `Agent` to create a child of another (`agent-core/tools/agent/agent-type.ts`).
 */

/** What `Agent` needs to create a child: the chat's route and a worktree of its folder. */
export function agentLaunchPorts(input: {
  /** The model and effort the person chose per agent (`agentSettings.agentModelChoices`). */
  choices?: readonly AgentModelChoice[]
  /** The chat's folder: an isolated agent works in a worktree of its repository. */
  defaultCwd: string
  /** The conversation the worktrees are grouped under. */
  rootSessionId: string
  /** The run's WorktreeCreate hooks, which replace `git worktree add` when present (CC). */
  worktreeHook?: WorktreeHook
  /** `tools: Agent(a, b)` of the agent the run is: the only types it may delegate to. */
  allowedAgentTypes?: readonly string[]
  /** The run's model and the models its providers offer: what an agent file's `model` routes to. */
  models?: SubagentModelContext
  /** The tools this run offers, once built: what a child's agent type chooses among. */
  parentTools?: () => readonly NamedTool[]
}): AgentLaunchPorts {
  const { models, parentTools } = input
  return {
    ...(parentTools ? { toolsRefusal: (type) => childToolsRefusal(type, parentTools()) } : {}),
    ...(models ? { subagentRoute: (ask) => subagentModelRoute(ask, models) } : {}),
    ...(input.allowedAgentTypes ? { allowedAgentTypes: input.allowedAgentTypes } : {}),
    ...(input.choices ? { choices: input.choices } : {}),
    isolate: async (name) => {
      const made = await input.worktreeHook?.(name)
      if (made) return adoptHookWorktree(made)
      return createAgentWorktree({ cwd: input.defaultCwd, name, group: input.rootSessionId })
    },
  }
}

/** A child of `type` is refused when its `tools` resolve to nothing among the run's tools. */
function childToolsRefusal(type: TaskAgentType, pool: readonly NamedTool[]): string | undefined {
  if (type.tools === undefined) return undefined
  return agentToolsRefusal({ name: type.fullName, tools: type.tools }, pool, {
    asMainThread: false,
    background: type.background === true,
    atDepthLimit: true,
    permissionMode: type.permissionMode ?? 'default',
  })
}

/**
 * Run the route as the catalog agent behind it: its prompt is the run's identity and its tool
 * ceiling applies, as for a Claude Code subagent. Null when nothing stands behind the route (the
 * default agent has no file, and a test builds an agent by hand).
 */
export function applyCatalogAgent<Agent extends { instructions?: string | null }>(
  input: { agent: Agent; disabledTools: readonly string[] },
  spec: LoadedPluginAgent | undefined,
): { agent: Agent; disabledTools: string[]; subagent: LoadedPluginAgent } | null {
  return spec ? { ...runAsPluginAgent(input, spec), subagent: spec } : null
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
