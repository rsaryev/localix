import type { DelegateAgentPorts } from '../../../agent-core/tools/delegate-agent-type'
import { agentModelRoute, type ChatModel } from '../../../agent-core/agent-model-route'
import {
  adoptHookWorktree,
  type WorktreeHook,
} from '../../../agent-core/tools/workflow/hook-worktree'
import { createAgentWorktree } from '../../../agent-core/tools/workflow/worktree'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'
import { runAsPluginAgent } from './plugin-main-agent'

/**
 * What a run takes from the agent it is seated as (`applySpeakerAgent`), and what it lends
 * `delegate` to create a child of another (`agent-core/tools/delegate-agent-type.ts`).
 */

/** What `delegate` needs to create a child: the chat's route and a worktree of its folder. */
export function delegateAgentPorts(input: {
  chatModel?: ChatModel
  catalog: readonly { id: string; providerId: string }[]
  /** The chat's folder: an isolated agent works in a worktree of its repository. */
  defaultCwd: string
  /** The conversation the worktrees are grouped under. */
  rootSessionId: string
  /** The run's WorktreeCreate hooks, which replace `git worktree add` when present (CC). */
  worktreeHook?: WorktreeHook
  /** `tools: Agent(a, b)` of the agent the run is: the only types it may delegate to. */
  allowedAgentTypes?: readonly string[]
}): DelegateAgentPorts {
  const { chatModel, catalog } = input
  return {
    ...(input.allowedAgentTypes ? { allowedAgentTypes: input.allowedAgentTypes } : {}),
    ...(chatModel
      ? {
          route: (asked) =>
            agentModelRoute(
              { model: asked.model, effort: asked.effort, route: asked.route },
              { chat: chatModel, catalog, who: asked.who },
            ),
        }
      : {}),
    isolate: async (name) => {
      const made = await input.worktreeHook?.(name)
      if (made) return adoptHookWorktree(made)
      return createAgentWorktree({ cwd: input.defaultCwd, name, group: input.rootSessionId })
    },
  }
}

/**
 * Run the seat as the catalog agent behind it: its prompt is the run's identity and its tool
 * ceiling applies, as for a Claude Code subagent. Null when nothing stands behind the seat (the
 * default agent has no file, and a test builds an agent by hand).
 */
export function applySpeakerAgent<Agent extends { instructions?: string | null }>(
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
