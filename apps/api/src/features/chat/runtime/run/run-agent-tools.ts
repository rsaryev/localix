import { delegatesAt, MAX_DELEGATION_DEPTH } from '../../../agent-core/delegation-hierarchy'
import { BUILTIN_TOOL_NAMES } from '../../../agent-core/tool-names'
import {
  agentToolCandidates,
  narrowAgentTools,
  type AgentToolRun,
  type NamedTool,
} from '../../../plugins/kit'
import type { CatalogAgent } from '@rsaryev/llx-plugin/agents'

/** Whose `tools` and `disallowedTools` narrow the run (`plugin-main-agent.ts` `runToolsAgent`). */
export interface RunToolsAgent {
  readonly agent: CatalogAgent
  readonly asMainThread: boolean
}

/** What an agent's tool fields do to one run, before and after its tools are built. */
export interface RunAgentTools {
  /** What the run profile reads of the agent: `tools`, the built-ins its list names (none: it inherits). */
  readonly profileAgent?: { readonly tools?: readonly string[] }
  /** `tools: Agent(a, b)` of a main-thread agent: the only types `Agent` may start. */
  readonly spawnTypes?: readonly string[]
  /** The run's tools its agent's fields leave it. */
  readonly narrow?: <T extends NamedTool>(tools: readonly T[]) => T[]
}

/**
 * The kit's reading of the agent's `tools` and `disallowedTools` for this run
 * (`plugins/kit/subagent-tools.ts`). A fork holds its parent's tools: nothing narrows it.
 */
export function runAgentTools(
  toolsAgent: RunToolsAgent | null | undefined,
  permissionMode: string,
  fork: boolean,
): RunAgentTools {
  if (!toolsAgent || fork) return {}
  const { agent, asMainThread } = toolsAgent
  const run: AgentToolRun = {
    asMainThread,
    // Localix records no `run_in_background` on the child: an agent file's `background` says it.
    background: agent.definition.background === true,
    atDepthLimit: !asMainThread && !delegatesAt(MAX_DELEGATION_DEPTH),
    permissionMode,
  }
  const fields = { ...agent.definition, name: agent.name }
  const { declared, spawnTypes } = agentToolCandidates(fields, BUILTIN_TOOL_NAMES, run)
  return {
    profileAgent: declared === null ? {} : { tools: declared },
    ...(spawnTypes ? { spawnTypes } : {}),
    narrow: (tools) => narrowAgentTools(fields, tools, run),
  }
}
