import type { TaskAgent, TaskAgentType, TaskDelegationOptions } from '../task-delegation-contracts'
import {
  agentPermissionModeOf,
  type AgentPermissionMode,
} from '../../../../contracts/agent-permission-mode'
import { agentChoiceRoute, type AgentModelChoice, type AgentRoute } from '../../agent-model-route'

/**
 * WHO A DELEGATED TASK GOES TO, as Claude Code's Agent tool runs it: `agent: "<name>"` names one
 * agent of the catalog (a `.claude/agents` file, a plugin's `<plugin>:<name>`, `Explore`, `Plan`),
 * and the child is a fresh run of THAT agent, started by its own id. Its prompt, tool ceiling,
 * model and memory come from its definition when the child runs (`stages/context.ts`); at creation
 * the child takes the rest of its frontmatter: `model` and `effort` (an alias resolves against the
 * chat's provider, as a workflow agent's does; `inherit` keeps the chat's model), `skills`
 * preloaded, `maxTurns`, `background` (never held by `wait`) and `isolation: worktree` (a git
 * worktree of the chat's repository, kept for the child's life). The person's own agent files
 * (never a plugin's, as in Claude Code) also carry their `permissionMode` onto the child, which the run
 * weighs against the conversation's; their `hooks` and `mcpServers` apply when the child runs.
 *
 * `general-purpose` (and `claude`) is the delegating agent itself, so is an `agent` left out.
 */

/** Claude Code's `agent_type` for a child that runs as its delegator. */
export const GENERAL_PURPOSE_TYPE = 'general-purpose'

/** A worktree made for an isolated child (`workflow/worktree.ts` makes one). */
export interface AgentWorktree {
  dir: string
  workingDir: string
  branch?: string
  byHook?: true
}

/** What the chat lends `Agent` for the children it starts. */
export interface AgentLaunchPorts {
  /** The model and effort the person chose for each agent (`agentSettings.agentModelChoices`). */
  choices?: readonly AgentModelChoice[]
  /**
   * The agent types this run may start: `tools: Agent(worker, researcher)` of the agent it
   * runs as. Absent means any type. An omitted `agent` is `general-purpose`.
   */
  allowedAgentTypes?: readonly string[]
  /** A fresh worktree of the chat's repository, for `isolation: worktree`. */
  isolate?: (name: string) => Promise<AgentWorktree>
}

/** Who runs a task: the route to create, and the definition it runs as when it is not the delegator. */
export type AgentTarget = { agent: TaskAgent; type?: TaskAgentType } | { refusal: string }

const notFound = (reference: string) =>
  `No enabled agent "${reference}" here. Name one from the agent directory, or omit subagent_type to run the task yourself.`

/** Resolve `agent` for a start: the catalog's answer, then the refusals Claude Code makes. */
export async function resolveAgentTarget(
  reference: string,
  delegator: TaskAgent,
  opts: Pick<TaskDelegationOptions, 'resolveTarget' | 'projectId'>,
): Promise<AgentTarget> {
  const found = await opts.resolveTarget(reference, { projectId: opts.projectId })
  switch (found.kind) {
    case 'self':
      return { agent: delegator }
    case 'ambiguous':
      return { refusal: `"${reference}" names several agents: ${found.names.join(', ')}.` }
    case 'unavailable':
      return { refusal: notFound(reference) }
    case 'agent':
      // Claude Code refuses to launch an agent whose `tools` resolve to nothing.
      if (found.type.tools?.length === 0)
        return {
          refusal: `Agent "${found.type.fullName}" would run with zero tools: none of the names in its tools list is a tool here. Fix the agent file's tools, or start the Agent without this subagent_type.`,
        }
      return { agent: found.agent, type: found.type }
  }
}

/** Whether the agent's file is the person's own: a user's, a project's or a managed one. */
export const ownsFrontmatter = (type: Pick<TaskAgentType, 'source'> | undefined): boolean =>
  type?.source === 'user' || type?.source === 'project' || type?.source === 'managed'

/**
 * The refusal when the run's `Agent(...)` allowlist leaves out every name the target answers to
 * (its name, full name, name; `general-purpose` for the delegator itself and a fork), else none.
 */
export function agentTypeRefusal(
  ports: Pick<AgentLaunchPorts, 'allowedAgentTypes'> | undefined,
  names: readonly string[],
): string | undefined {
  const allowed = ports?.allowedAgentTypes
  if (!allowed) return undefined
  const lower = new Set(allowed.map((type) => type.toLowerCase()))
  if (names.some((name) => lower.has(name.toLowerCase()))) return undefined
  return `This agent may start only these subagent types: ${allowed.join(', ') || 'none'}. ${names[0]} is not one of them.`
}

/** What a child is created with besides its agent. */
export interface AgentChild {
  provenance: {
    workingDir?: string
    worktreeByHook?: true
    agentPermissionMode?: AgentPermissionMode
  }
  route: AgentRoute
  pinnedSkills?: string[]
  notes: string[]
  /** Where an isolated child works, and its branch: Claude Code's `worktreePath`/`worktreeBranch`. */
  worktree?: { path: string; branch?: string }
}

/** A worktree name from the delegating call: a plain folder name, unique to the child. */
const worktreeName = (toolCallId: string) =>
  `agent-${toolCallId.replace(/[^A-Za-z0-9._-]/g, '-')}`.slice(0, 120)

/** A fresh worktree for one child, and the note that says where it is. */
export async function isolateChild(
  ports: AgentLaunchPorts | undefined,
  toolCallId: string,
  who: string,
): Promise<{
  provenance: { workingDir: string; worktreeByHook?: true }
  note: string
  worktree: { path: string; branch?: string }
}> {
  if (!ports?.isolate) throw new Error('isolation: worktree is not available in this chat')
  const worktree = await ports.isolate(worktreeName(toolCallId))
  return {
    provenance: {
      workingDir: worktree.workingDir,
      ...(worktree.byHook ? { worktreeByHook: true as const } : {}),
    },
    worktree: { path: worktree.dir, ...(worktree.branch ? { branch: worktree.branch } : {}) },
    note: `${who} works in the worktree ${worktree.dir}${worktree.branch ? ` (branch ${worktree.branch})` : ''}; it is kept, remove it when the work is merged`,
  }
}

/** What the delegating call itself asks of the child. */
export interface ChildCall {
  toolCallId: string
  /** The agent the child runs as: the person's choice for it, if any, is its route. A fork has none: it runs as its parent. */
  agentId?: string
  isolate?: boolean
  /** The caller makes the worktree itself (a workflow), so the agent's own isolation adds none. */
  isolated?: boolean
}

/**
 * The route, skills and folder a child is created with. The route is the person's choice for the
 * agent, if they made one, else nothing, which leaves the child on its session's model and effort
 * (`agent-model-route.ts`). Neither the agent's file nor the call has a say; `isolation` from the
 * call isolates a child the file does not.
 */
export async function prepareAgentChild(
  who: string,
  type: TaskAgentType | undefined,
  ports: AgentLaunchPorts | undefined,
  call: ChildCall,
): Promise<AgentChild> {
  const notes: string[] = []
  const chosen: AgentRoute = call.agentId ? agentChoiceRoute(ports?.choices, call.agentId) : {}
  const provenance: AgentChild['provenance'] = {}
  let worktree: AgentChild['worktree']
  // The person's own agent files (not a plugin's, as in Claude Code) ask for a permission mode;
  // the run weighs it against the conversation's (`contracts/agent-permission-mode.ts`).
  const asked = ownsFrontmatter(type) ? agentPermissionModeOf(type?.permissionMode) : undefined
  if (asked) provenance.agentPermissionMode = asked
  if ((type?.isolation && !call.isolated) || call.isolate) {
    const isolated = await isolateChild(ports, call.toolCallId, who)
    Object.assign(provenance, isolated.provenance)
    notes.push(isolated.note)
    worktree = isolated.worktree
  }
  return {
    provenance,
    ...(worktree ? { worktree } : {}),
    route: chosen,
    ...(type?.pinnedSkills?.length ? { pinnedSkills: [...type.pinnedSkills] } : {}),
    notes,
  }
}
