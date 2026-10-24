import type { DelegateAgent, TaskDelegationOptions } from './task-delegation-contracts'
import type { WorkflowAgentRoute } from './workflow/agent-start'

/**
 * A Claude Code plugin's agents as `delegate`'s SUBAGENT TYPES, as Claude Code's Agent tool runs
 * them: `agent: "<plugin>:<name>"` (or a bare name only one enabled plugin defines) starts a child
 * that runs as that agent.
 *
 * The child is seated with the delegating agent — a plugin agent is not a registry agent — and its
 * provenance names the type, so every run of the child takes the agent's prompt as its identity and
 * its `tools` / `disallowedTools` as limits (`chat/runtime/run/plugin-subagent.ts`). At creation the
 * child takes the rest of its frontmatter: `model` and `effort` (an alias resolves against the
 * chat's provider, as a workflow agent's does; `inherit` keeps the chat's model), `skills`
 * preloaded, `maxTurns`, `background` (never held by `wait`) and `isolation: worktree` (a git
 * worktree of the chat's repository, kept for the child's life). As in Claude Code, a plugin
 * agent's `hooks`, `mcpServers` and `permissionMode` are ignored.
 */

/** One enabled plugin agent, as `delegate` needs it (`LoadedPluginAgent` is one). */
export interface PluginAgentType {
  fullName: string
  name: string
  description: string
  preferredModel?: string
  preferredEffort?: string
  pinnedSkills?: readonly string[]
  maxTurns?: number
  background?: boolean
  isolation?: 'isolated'
}

/** A worktree made for an isolated child (`workflow/worktree.ts` makes one). */
export interface PluginAgentWorktree {
  dir: string
  workingDir: string
  branch?: string
  byHook?: true
}

type MaybePromise<T> = T | Promise<T>

/** What the chat lends `delegate` for its plugin agents. */
export interface DelegatePluginPorts {
  /** The enabled plugins' agents in this run. */
  agents: () => readonly PluginAgentType[]
  /** The route for a `model` and an `effort`, with a note for what could not be applied. */
  route?: (asked: {
    model?: string
    effort?: string
    who: string
  }) => MaybePromise<{ route: WorkflowAgentRoute; notes: string[] }>
  /** A fresh worktree of the chat's repository, for `isolation: worktree`. */
  isolate?: (name: string) => Promise<PluginAgentWorktree>
}

export type PluginAgentMatch = { agent: PluginAgentType } | { ambiguous: string[] } | null

/** The plugin agent `reference` names: its full name, or a bare name one plugin alone defines. */
export function matchPluginAgent(
  reference: string,
  agents: readonly PluginAgentType[],
): PluginAgentMatch {
  const wanted = reference.trim().replace(/^@/, '').toLowerCase()
  if (!wanted) return null
  const exact = agents.find((agent) => agent.fullName.toLowerCase() === wanted)
  if (exact) return { agent: exact }
  const bare = agents.filter((agent) => agent.name.toLowerCase() === wanted)
  if (bare.length === 1) return { agent: bare[0]! }
  return bare.length > 1 ? { ambiguous: bare.map((agent) => agent.fullName) } : null
}

/** Who runs a task: a registry agent, or the delegating agent seated as a plugin agent type. */
export type DelegateTarget =
  | { agent: DelegateAgent; plugin?: PluginAgentType }
  | { refusal: string }

/**
 * Claude Code's built-in catch-all subagent types: the delegator itself, with every tool. A task
 * handed to `general-purpose` (or `claude`) is the same as one with no `agent` at all.
 */
const SELF_TYPES = new Set(['general-purpose', 'claude'])

const notFound = (reference: string) =>
  `No enabled agent "${reference}" here. Name one from the agent directory or the agent types, or omit agent to run the task yourself.`

/**
 * Resolve `agent` for a start. A name with a `:` is a plugin type first; any other name is a
 * registry agent first, then a plugin type's bare name.
 */
export async function resolveDelegateTarget(
  reference: string,
  delegator: DelegateAgent,
  opts: Pick<TaskDelegationOptions, 'resolveAgent' | 'projectId'>,
  plugins: DelegatePluginPorts | undefined,
): Promise<DelegateTarget> {
  const registry = async () => opts.resolveAgent(reference, { projectId: opts.projectId })
  const plugin = (): DelegateTarget | null => {
    const match = plugins ? matchPluginAgent(reference, plugins.agents()) : null
    if (!match) return null
    if ('ambiguous' in match)
      return { refusal: `"${reference}" names several agent types: ${match.ambiguous.join(', ')}.` }
    return { agent: delegator, plugin: match.agent }
  }
  if (reference.includes(':')) {
    const typed = plugin()
    if (typed) return typed
  }
  const agent = await registry()
  if (agent) return { agent }
  const typed = plugin()
  if (typed) return typed
  // A plugin or registry agent of the same name came first, as one replaces Claude Code's built-in.
  if (SELF_TYPES.has(reference.trim().replace(/^@/, '').toLowerCase())) return { agent: delegator }
  return { refusal: notFound(reference) }
}

/** What a plugin agent adds to its child's creation. */
export interface PluginAgentChild {
  provenance: { pluginAgent: string; workingDir?: string; worktreeByHook?: true }
  route: WorkflowAgentRoute
  pinnedSkills?: string[]
  notes: string[]
}

/** A worktree name from the delegating call: a plain folder name, unique to the child. */
const worktreeName = (toolCallId: string) =>
  `delegate-${toolCallId.replace(/[^A-Za-z0-9._-]/g, '-')}`.slice(0, 120)

/** A fresh worktree for one child, and the note that says where it is. */
export async function isolateChild(
  ports: DelegatePluginPorts,
  toolCallId: string,
  who: string,
): Promise<{ provenance: { workingDir: string; worktreeByHook?: true }; note: string }> {
  if (!ports.isolate) throw new Error('isolation: worktree is not available in this chat')
  const worktree = await ports.isolate(worktreeName(toolCallId))
  return {
    provenance: {
      workingDir: worktree.workingDir,
      ...(worktree.byHook ? { worktreeByHook: true as const } : {}),
    },
    note: `${who} works in the worktree ${worktree.dir}${worktree.branch ? ` (branch ${worktree.branch})` : ''}; it is kept, remove it when the work is merged`,
  }
}

/**
 * The route, skills and folder a plugin agent's child is created with. A model the call names (or
 * a mod's `agent.spawn` picked) wins over the agent's own, as Claude Code's per-call `model` does,
 * and so does a call's `effort`; `isolation` from the call isolates a child the file does not.
 */
export async function preparePluginAgentChild(
  agent: PluginAgentType,
  ports: DelegatePluginPorts,
  call: { toolCallId: string; hostModel: boolean; effort?: string; isolate?: boolean },
): Promise<PluginAgentChild> {
  const who = `agent ${agent.fullName}`
  const model = call.hostModel ? undefined : agent.preferredModel
  const effort = call.effort ?? agent.preferredEffort
  const notes: string[] = []
  let route: WorkflowAgentRoute = {}
  if (model || effort) {
    if (ports.route) {
      const resolved = await ports.route({ model, effort, who })
      route = resolved.route
      notes.push(...resolved.notes)
    } else if (model && model.toLowerCase() !== 'inherit') {
      notes.push(`${who} model "${model}" cannot be resolved here; the agent runs on the chat's`)
    }
  }
  const provenance: PluginAgentChild['provenance'] = { pluginAgent: agent.fullName }
  if (agent.isolation || call.isolate) {
    const isolated = await isolateChild(ports, call.toolCallId, who)
    Object.assign(provenance, isolated.provenance)
    notes.push(isolated.note)
  }
  return {
    provenance,
    route,
    ...(agent.pinnedSkills?.length ? { pinnedSkills: [...agent.pinnedSkills] } : {}),
    notes,
  }
}
