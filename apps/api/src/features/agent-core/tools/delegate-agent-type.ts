import type {
  DelegateAgent,
  DelegateAgentType,
  TaskDelegationOptions,
} from './task-delegation-contracts'
import { agentModelRoute, type AgentRoute } from '../agent-model-route'

/**
 * WHO A DELEGATED TASK GOES TO, as Claude Code's Agent tool runs it: `agent: "<name>"` names one
 * agent of the catalog (a `.claude/agents` file, a plugin's `<plugin>:<name>`, `Explore`, `Plan`),
 * and the child is a fresh run of THAT agent, seated by its own id. Its prompt, tool ceiling,
 * model and memory come from its definition when the child runs (`stages/context.ts`); at creation
 * the child takes the rest of its frontmatter: `model` and `effort` (an alias resolves against the
 * chat's provider, as a workflow agent's does; `inherit` keeps the chat's model), `skills`
 * preloaded, `maxTurns`, `background` (never held by `wait`) and `isolation: worktree` (a git
 * worktree of the chat's repository, kept for the child's life). As in Claude Code, an agent's
 * `hooks`, `mcpServers` and `permissionMode` are ignored here.
 *
 * `general-purpose` (and `claude`) is the delegating agent itself, so is an `agent` left out.
 */

/** Claude Code's `agent_type` for a child that runs as its delegator. */
export const GENERAL_PURPOSE_TYPE = 'general-purpose'

/** A worktree made for an isolated child (`workflow/worktree.ts` makes one). */
export interface DelegateWorktree {
  dir: string
  workingDir: string
  branch?: string
  byHook?: true
}

type MaybePromise<T> = T | Promise<T>

/** What the chat lends `delegate` for the children it starts. */
export interface DelegateAgentPorts {
  /** The route for a `model`, an `effort` and a `localix.model`, with the notes for what failed. */
  route?: (asked: {
    model?: string
    effort?: string
    route?: string
    who: string
  }) => MaybePromise<{ route: AgentRoute; notes: string[] }>
  /** A fresh worktree of the chat's repository, for `isolation: worktree`. */
  isolate?: (name: string) => Promise<DelegateWorktree>
}

/** Who runs a task: the seat to create, and the definition it runs as when it is not the delegator. */
export type DelegateTarget =
  | { agent: DelegateAgent; type?: DelegateAgentType }
  | { refusal: string }

const notFound = (reference: string) =>
  `No enabled agent "${reference}" here. Name one from the agent directory, or omit agent to run the task yourself.`

/** Resolve `agent` for a start: the catalog's answer, then the refusals Claude Code makes. */
export async function resolveDelegateTarget(
  reference: string,
  delegator: DelegateAgent,
  opts: Pick<TaskDelegationOptions, 'resolveTarget' | 'projectId'>,
): Promise<DelegateTarget> {
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
      if (found.type.tools && found.type.tools.length === 0)
        return {
          refusal: `Agent "${found.type.fullName}" would run with zero tools: none of the names in its tools list is a tool here. Fix the agent file's tools, or delegate without this agent.`,
        }
      return { agent: found.agent, type: found.type }
  }
}

/** What a child is created with besides its seat. */
export interface AgentChild {
  provenance: { workingDir?: string; worktreeByHook?: true }
  route: AgentRoute
  pinnedSkills?: string[]
  notes: string[]
}

/** A worktree name from the delegating call: a plain folder name, unique to the child. */
const worktreeName = (toolCallId: string) =>
  `delegate-${toolCallId.replace(/[^A-Za-z0-9._-]/g, '-')}`.slice(0, 120)

/** A fresh worktree for one child, and the note that says where it is. */
export async function isolateChild(
  ports: DelegateAgentPorts | undefined,
  toolCallId: string,
  who: string,
): Promise<{ provenance: { workingDir: string; worktreeByHook?: true }; note: string }> {
  if (!ports?.isolate) throw new Error('isolation: worktree is not available in this chat')
  const worktree = await ports.isolate(worktreeName(toolCallId))
  return {
    provenance: {
      workingDir: worktree.workingDir,
      ...(worktree.byHook ? { worktreeByHook: true as const } : {}),
    },
    note: `${who} works in the worktree ${worktree.dir}${worktree.branch ? ` (branch ${worktree.branch})` : ''}; it is kept, remove it when the work is merged`,
  }
}

/** What the delegating call itself asks of the child. */
export interface ChildCall {
  toolCallId: string
  model?: string
  effort?: string
  isolate?: boolean
  /** The caller makes the worktree itself (a workflow), so the agent's own isolation adds none. */
  isolated?: boolean
}

/**
 * The route, skills and folder a child is created with. What the call names (or a mod's
 * `agent.spawn` picked) wins over the agent's own, as Claude Code's per-call `model` and `effort`
 * do; `isolation` from the call isolates a child the file does not. The agent's `localix.model`
 * route stands in for a `model` of `inherit`, and gives way to the call's model.
 */
export async function prepareAgentChild(
  who: string,
  type: DelegateAgentType | undefined,
  ports: DelegateAgentPorts | undefined,
  call: ChildCall,
): Promise<AgentChild> {
  const model = call.model ?? type?.preferredModel
  const effort = call.effort ?? type?.preferredEffort
  const route = call.model ? undefined : type?.localix?.model
  const notes: string[] = []
  let chosen: AgentRoute = {}
  if (model || effort || route) {
    const ask = {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(route ? { route } : {}),
    }
    if (ports?.route) {
      const resolved = await ports.route({ ...ask, who })
      chosen = resolved.route
      notes.push(...resolved.notes)
    } else {
      chosen = agentModelRoute(ask, { who }).route
      if (model && model.toLowerCase() !== 'inherit' && !chosen.modelId)
        notes.push(`${who} model "${model}" cannot be resolved here; the agent runs on the chat's`)
    }
    // A model the caller named is used as written when the chat's provider does not list it.
    if (call.model && !chosen.modelId) {
      const written = agentModelRoute({ model: call.model }, {}).route
      if (written.modelId) chosen = { ...chosen, ...written }
    }
  }
  const provenance: AgentChild['provenance'] = {}
  if ((type?.isolation && !call.isolated) || call.isolate) {
    const isolated = await isolateChild(ports, call.toolCallId, who)
    Object.assign(provenance, isolated.provenance)
    notes.push(isolated.note)
  }
  return {
    provenance,
    route: chosen,
    ...(type?.pinnedSkills?.length ? { pinnedSkills: [...type.pinnedSkills] } : {}),
    notes,
  }
}
