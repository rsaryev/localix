import type { AgentTool } from '@localixai/agent/agents'
import {
  cachedIn,
  ENGINE_PROVIDER,
  fieldOf,
  fireIn,
  hearsIn,
  type ModEventScope,
} from './event-scope'
import { claudeCodeToolName } from '../ext/cc-tool-shapes'

/**
 * `tool.describe`: each tool of a run as the model will read it — its description, and whether it
 * waits behind `ToolSearch` (Localix's ToolSearch) or rides the request's list. Asked once per
 * tool and conversation and kept until `$.ui.invalidate('tool.describe')`, so the tool schemas
 * the provider caches stay the same from request to request.
 */

export interface ToolPlacement {
  /** Where each tool came from (an MCP server, `plugins`); a name absent from it is core's. */
  sources: ReadonlyMap<string, string>
  /** Tools the engine lists behind the activator now. */
  deferred: (name: string) => boolean
}

export interface DescribedTools {
  tools: AgentTool[]
  /** The tools a hook moved: true behind the activator, false onto the request's list. */
  placed: ReadonlyMap<string, boolean>
}

const providerOf = (source: string | undefined, name: string) =>
  !source
    ? ENGINE_PROVIDER
    : source === 'plugins'
      ? { plugin: /^mcp__([^_]+)__/.exec(name)?.[1] ?? 'plugin', tier: 'user' }
      : { plugin: `mcp:${source}`, tier: 'user' }

/** The `[MCP: server] ` Localix leads an MCP tool's description with; Claude Code's has none. */
const MCP_LEAD = /^\[MCP: [^\]]*\] /

export async function describeTools(
  scope: ModEventScope,
  tools: readonly AgentTool[],
  placement: ToolPlacement,
): Promise<DescribedTools> {
  const placed = new Map<string, boolean>()
  if (!hearsIn(scope, 'tool.describe')) return { tools: [...tools], placed }
  const described = await Promise.all(
    tools.map(async (tool) => {
      const deferred = placement.deferred(tool.name)
      const lead = MCP_LEAD.exec(tool.description)?.[0] ?? ''
      const own = tool.description.slice(lead.length)
      const input = {
        tool: claudeCodeToolName(tool),
        description: own,
        ...(deferred ? { isDeferred: true } : {}),
        provider: providerOf(placement.sources.get(tool.name), tool.name),
      }
      const answer = await cachedIn(
        scope,
        'tool.describe',
        [tool.name, tool.description, deferred],
        () =>
          fireIn(scope, 'tool.describe', input, (e) => ({
            description: fieldOf(e, 'description'),
            ...(deferred ? { isDeferred: true } : {}),
          })),
      )
      const description = fieldOf(answer, 'description')
      const isDeferred = fieldOf(answer, 'isDeferred')
      if (typeof isDeferred === 'boolean' && isDeferred !== deferred)
        placed.set(tool.name, isDeferred)
      // A rewrite keeps Localix's lead, which names the server for the model.
      return typeof description === 'string' && description !== own
        ? { ...tool, description: `${lead}${description}` }
        : tool
    }),
  )
  return { tools: described, placed }
}
