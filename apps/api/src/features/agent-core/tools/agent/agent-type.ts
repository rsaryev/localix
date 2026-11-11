import type { TaskAgent, TaskAgentType, TaskDelegationOptions } from '../task-delegation-contracts'
import type { AgentPermissionMode } from '../../../../contracts/agent-permission-mode'
import { agentChoiceRoute, type AgentModelChoice, type AgentRoute } from '../../agent-model-route'

/**
 * WHO A DELEGATED TASK GOES TO, as Claude Code's Agent tool runs it: `agent: "<name>"` names one
 * agent of the catalog (a `.claude/agents` file, a plugin's `<plugin>:<name>`, `Explore`, `Plan`),
 * and the child is a fresh run of THAT agent, started by its own id. Its prompt, tool ceiling,
 * and memory come from its definition when the child runs (`stages/context.ts`); at creation the
 * child takes the rest of its frontmatter: `model` when the person chose no model for the agent (an
 * alias resolves against the chat's provider; `inherit` keeps the chat's model), `skills` preloaded, `maxTurns`, `background` (never held by `wait`) and `isolation: worktree` (a git
 * worktree of the chat's repository, kept for the child's life). The `permissionMode` the kit
 * resolved for the agent rides onto the child, which the run weighs against the conversation's;
 * its `hooks` and `mcpServers` apply when the child runs (the kit drops a plugin's).
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
   * Claude Code's refusal of a type `tools: Agent(worker, researcher)` of the agent the run is
   * leaves out (the kit's `spawnRefusal`), given the type as the call names it: an omitted `agent`
   * is `undefined`, a fork `fork`. Absent means any type.
   */
  spawnRefusal?: (subagentType: string | undefined) => string | undefined
  /** A fresh worktree of the chat's repository, for `isolation: worktree`. */
  isolate?: (name: string) => Promise<AgentWorktree>
  /** The route an agent file's `model` gives a child the person chose no model for. */
  subagentRoute?: (ask: { definition?: string; invocation?: string }) => AgentRoute
  /** Claude Code's refusal of an agent type whose `tools` resolve to nothing here, else none. */
  toolsRefusal?: (type: TaskAgentType) => string | undefined
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
  ports?: Pick<AgentLaunchPorts, 'toolsRefusal'>,
): Promise<AgentTarget> {
  const found = await opts.resolveTarget(reference, { projectId: opts.projectId })
  switch (found.kind) {
    case 'self':
      return { agent: delegator }
    case 'ambiguous':
      return { refusal: `"${reference}" names several agents: ${found.names.join(', ')}.` }
    case 'unavailable':
      return { refusal: notFound(reference) }
    case 'agent': {
      // Claude Code refuses to launch an agent whose `tools` resolve to nothing.
      const refusal = ports?.toolsRefusal?.(found.type)
      return refusal ? { refusal } : { agent: found.agent, type: found.type }
    }
  }
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
  /** The `Agent` call's `model` alias. */
  model?: string
}

/**
 * The route, skills and folder a child is created with. The route is the person's choice for the
 * agent, if they made one; a model they did not choose is the call's `model`, the agent file's or
 * the environment's, as the kit resolves them (`subagentRoute`), else none, which leaves the child
 * on its session's model and effort (`agent-model-route.ts`). A fork runs on its parent's.
 * `isolation` from the call isolates a child the file does not.
 */
export async function prepareAgentChild(
  who: string,
  type: TaskAgentType | undefined,
  ports: AgentLaunchPorts | undefined,
  call: ChildCall,
): Promise<AgentChild> {
  const notes: string[] = []
  const choice: AgentRoute = call.agentId ? agentChoiceRoute(ports?.choices, call.agentId) : {}
  // The person's model for the agent, else the kit's model order (`plugins/kit/spawn.ts`).
  const ask = {
    ...(type?.definition.model ? { definition: type.definition.model } : {}),
    ...(call.model ? { invocation: call.model } : {}),
  }
  const fromFile = call.agentId && !choice.modelId ? (ports?.subagentRoute?.(ask) ?? {}) : {}
  const chosen: AgentRoute = { ...fromFile, ...choice }
  const provenance: AgentChild['provenance'] = {}
  let worktree: AgentChild['worktree']
  // The mode the agent asks for; the run weighs it against the conversation's (`plugins/kit/spawn.ts`).
  const asked = type?.askedMode
  if (asked) provenance.agentPermissionMode = asked
  if ((type?.extras.isolation === 'worktree' && !call.isolated) || call.isolate) {
    const isolated = await isolateChild(ports, call.toolCallId, who)
    Object.assign(provenance, isolated.provenance)
    notes.push(isolated.note)
    worktree = isolated.worktree
  }
  return {
    provenance,
    ...(worktree ? { worktree } : {}),
    route: chosen,
    ...(type?.definition.skills?.length ? { pinnedSkills: [...type.definition.skills] } : {}),
    notes,
  }
}
