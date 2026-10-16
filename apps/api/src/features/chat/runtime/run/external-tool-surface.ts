import type { AgentTool, ToolSurface } from '@localixai/agent/agents'
import {
  NO_ROSTERS,
  projectCapabilities,
  type ResolvedCapabilities,
} from '../../../capabilities/resolve'
import type { RunProfile } from '../../../agent-core/run-shape'
import { isLive, resolveToolSurface } from '../../../agent-core/tool-ledger'

/** Dynamic descriptors pass the same shape, host, model and policy gates as the core registry. */
export function externalToolSurface(input: {
  tools: readonly AgentTool[]
  profile: RunProfile
  capabilities: ResolvedCapabilities
  disabledTools: readonly string[]
  authority?: ToolSurface
  modelInput?: readonly string[]
}) {
  const policy = projectCapabilities(input.capabilities, {
    ...NO_ROSTERS,
    tool: input.tools.map((tool) => tool.name),
  })
  const ledger = resolveToolSurface(
    {
      profile: input.profile,
      authority: input.authority?.capabilities,
      modelInput: input.modelInput,
      disabledTools: new Set([...input.disabledTools, ...policy.denied.tool]),
      toolDenials: new Map(policy.toolDenials.map(({ name, rule }) => [name, { rule }])),
    },
    input.tools.map((tool) => ({ name: tool.name, tool })),
  )
  const tools = input.tools
    .filter((tool) => isLive(ledger, tool.name))
    .map((tool) => (input.modelInput && tool.forModel ? tool.forModel(input.modelInput) : tool))
  return { tools, ledger }
}
