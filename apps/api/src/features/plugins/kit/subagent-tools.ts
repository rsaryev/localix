import {
  parseToolEntry,
  resolveSubagentTools,
  type SubagentRun,
  type ToolsOutcome,
} from '@rsaryev/llx-plugin/agents'
import { normalizePermissionMode } from '@rsaryev/llx-plugin'
import { normalizeMcpToolAlias } from '../../agent-core/mcp-tool-alias'
import { localixToolNames, withRunTools, type NamedTool } from './tool-names'

/**
 * WHICH TOOLS AN AGENT FILE'S `tools` AND `disallowedTools` LEAVE A RUN: the kit's
 * `resolveSubagentTools` over the run's tools, named as Localix's (`tool-names.ts`). Before the
 * tools are built (`agentToolCandidates`) it says which built-ins to build and which types
 * `Agent` may start; after (`narrowAgentTools`) it is the run's exact roster.
 */

/** An agent as far as its tools go: the two fields as its file wrote them. */
export interface AgentToolFields {
  readonly name: string
  readonly tools?: readonly string[]
  readonly disallowedTools?: readonly string[]
}

/** How the run starts, as far as its tools go. */
export interface AgentToolRun {
  /** The agent is the main thread (a plugin's `agent` setting), not a subagent. */
  readonly asMainThread: boolean
  readonly background: boolean
  /** The run may start no subagent of its own. */
  readonly atDepthLimit: boolean
  readonly permissionMode: string
}

/**
 * The run's own plumbing, which no list removes (Localix's, not Claude Code's): `ToolSearch` loads
 * the deferred tools the list allows, `ToolOutput` recovers an elided result, `ContextBudget`
 * reports on the conversation.
 */
const RUN_PLUMBING: ReadonlySet<string> = new Set(['ToolSearch', 'ToolOutput', 'ContextBudget'])

const subagentRun = (run: AgentToolRun): SubagentRun => ({
  kind: 'subagent',
  background: run.background,
  atDepthLimit: run.atDepthLimit,
  permissionMode: normalizePermissionMode(run.permissionMode) ?? 'default',
  asMainThread: run.asMainThread,
})

const serverOf = (address: string) => address.split('__')[1] ?? ''

function resolve(agent: AgentToolFields, pool: readonly NamedTool[], run: AgentToolRun) {
  const [mcp, builtin] = [
    pool.filter((t) => t.aliases?.length),
    pool.filter((t) => !t.aliases?.length),
  ]
  const fields = {
    name: agent.name,
    ...(agent.tools ? { tools: [...agent.tools] } : {}),
    ...(agent.disallowedTools ? { disallowedTools: [...agent.disallowedTools] } : {}),
  }
  return resolveSubagentTools(
    fields,
    {
      builtin: builtin.map((tool) => tool.name),
      mcp: mcp.map((tool) => ({ server: serverOf(tool.aliases![0]!), name: tool.name })),
      names: withRunTools(pool),
    },
    subagentRun(run),
  )
}

const spawnList = (outcome: ToolsOutcome) =>
  outcome.ok && Array.isArray(outcome.spawnTypes) ? (outcome.spawnTypes as string[]) : undefined

/**
 * Before the run's tools are built: the built-ins its list names (null without a list: it
 * inherits), its MCP entries under Localix's names so their servers are gathered, and the types
 * `tools: Agent(a, b)` lets a main-thread agent start.
 */
export function agentToolCandidates(
  agent: AgentToolFields,
  builtins: readonly string[],
  run: AgentToolRun,
): { declared: string[] | null; spawnTypes?: string[] } {
  const outcome = resolve(
    agent,
    builtins.map((name) => ({ name })),
    run,
  )
  const spawnTypes = spawnList(outcome)
  const spawn = spawnTypes ? { spawnTypes } : {}
  if (agent.tools === undefined) return { declared: null, ...spawn }
  const mcp = agent.tools.flatMap((entry) => {
    const local = normalizeMcpToolAlias(parseToolEntry(entry).name)
    return local ? [local] : []
  })
  const listed = outcome.ok ? [...outcome.tools] : []
  return { declared: [...new Set([...listed, ...mcp])], ...spawn }
}

/** The run's tools its agent's fields leave it, the run plumbing kept. */
export function narrowAgentTools<T extends NamedTool>(
  agent: AgentToolFields,
  pool: readonly T[],
  run: AgentToolRun,
): T[] {
  const outcome = resolve(agent, pool, run)
  const kept = new Set(outcome.ok ? outcome.tools : [])
  return pool.filter((tool) => kept.has(tool.name) || RUN_PLUMBING.has(tool.name))
}

/** Claude Code's refusal to start an agent whose `tools` resolve to nothing, else none. */
export function agentToolsRefusal(
  agent: AgentToolFields,
  pool: readonly NamedTool[],
  run: AgentToolRun,
): string | undefined {
  const outcome = resolve(agent, pool, run)
  return outcome.ok ? undefined : outcome.refusal.message
}

/**
 * Whether an entry of an agent's `tools` or `disallowedTools`, or a command's tool list, names one
 * of Localix's `builtins` in Claude Code's terms (`Grep`, `Task`, `Bash(git *)`).
 */
export function namesBuiltinTool(entry: string, builtins: readonly string[]): boolean {
  const { name } = parseToolEntry(entry)
  return localixToolNames.hostNames(name).some((host) => builtins.includes(host))
}
