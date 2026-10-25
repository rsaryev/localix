import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { ACTIVATE_TOOLS_TOOL_NAME } from '../../tool-names'
import { normalizeMcpToolAlias } from '../../mcp-tool-alias'

/** One external tool advertised through the compact activation catalog. */
export interface DeferredToolEntry {
  tool: AgentTool
  /** Plugin id, MCP server name, or another provenance label. */
  source: string
}

export function buildDeferredEntry(tool: AgentTool, source: string): DeferredToolEntry {
  return { tool, source }
}

const MAX_TOOLS_PER_ACTIVATION = 8
const MAX_DESCRIPTION_LENGTH = 100

const inputSchema = z.object({
  names: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(MAX_TOOLS_PER_ACTIVATION)
    .describe('Exact tool names from the catalog, or an MCP tool as mcp__server__tool.'),
})

export interface ActivateToolsDetails {
  activated: string[]
  alreadyActive: string[]
  unknown: string[]
  available: string[]
}

function shortDescription(value: string | undefined): string {
  const normalized = (value ?? 'No description provided.').replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized
  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`
}

/** The name the model knows a tool by: its model name (an MCP tool's Claude Code name), or its own. */
const shownName = (tool: AgentTool): string => tool.modelName ?? tool.name

/** Stable, compact catalog shown to the model instead of full parameter schemas. */
export function renderToolCatalog(entries: readonly DeferredToolEntry[]): string {
  return [...entries]
    .sort((a, b) => shownName(a.tool).localeCompare(shownName(b.tool)))
    .map((entry) => {
      // A skill or prompt written for Claude Code names an MCP tool `mcp__<server>__<tool>`.
      const address = entry.tool.aliases?.find((alias) => alias.startsWith('mcp__'))
      const name = shownName(entry.tool)
      const also = address && address !== name ? ` (${address})` : ''
      return `- ${name}${also} [${entry.source}]: ${shortDescription(entry.tool.description)}`
    })
    .join('\n')
}

export interface ActivateToolsToolOptions {
  entries: readonly DeferredToolEntry[]
  /**
   * Names this SESSION activated earlier, already promoted onto the wire by the caller. They are here
   * so the tool can answer "you already have that one" instead of pretending to activate it again.
   */
  sessionActive?: readonly string[]
  /**
   * Newly activated names, reported as they happen so the caller can remember them for the session.
   * Without this the promotion dies with the run and the model pays a turn to re-activate the same tool.
   *
   * It may answer with names the session had to GIVE BACK to stay inside its budget; those are passed on
   * to the model, because a tool that vanishes from the wire without a word is worse than one that never
   * arrived.
   */
  onActivated?: (
    names: readonly string[],
  ) => void | readonly string[] | Promise<void | readonly string[]>
}

/**
 * Build the run-scoped activator for external plugin and MCP tools.
 *
 * The input deliberately stays `string[]`, not a dynamic enum: the compact catalog already
 * carries every exact name, while the stable schema avoids duplicating those names on the wire.
 * The host validates every requested name against this run's authoritative registry.
 */
export function createActivateToolsTool(options: ActivateToolsToolOptions) {
  const entries = [...options.entries].sort((a, b) => a.tool.name.localeCompare(b.tool.name))
  const availableByName = new Map(entries.map((entry) => [entry.tool.name, entry]))
  // The catalog shows a tool under its model name and the model calls it by that, so a request
  // for it needs no correction; `details` keeps the tool's own name, which the runtime reveals.
  const nameByModelName = new Map<string, string>()
  for (const { tool } of entries)
    if (tool.modelName && !availableByName.has(tool.modelName))
      nameByModelName.set(tool.modelName, tool.name)
  // A tool's other names resolve to it: an MCP tool's Claude Code name `mcp__<server>__<tool>`
  // (a plugin's server as `plugin_<plugin>_<server>`) is the one the person's docs and skills
  // use. A tool's own name always wins over another tool's alias.
  const nameByAlias = new Map<string, string>()
  for (const entry of entries)
    for (const alias of entry.tool.aliases ?? [])
      if (!availableByName.has(alias) && !nameByModelName.has(alias) && !nameByAlias.has(alias))
        nameByAlias.set(alias, entry.tool.name)
  const shown = (name: string) => {
    const tool = availableByName.get(name)?.tool
    return tool ? shownName(tool) : name
  }
  // Seeded from the session, so a name activated on an earlier turn is reported as already active
  // rather than re-announced — and the model is told the truth either way.
  const active = new Set<string>(options.sessionActive ?? [])
  // Advertising tools already on the wire invites redundant activation calls, especially for an
  // open plugin's tools. Keep the full registry for validation, but offer only deferred names.
  const deferredEntries = () => entries.filter((entry) => !active.has(entry.tool.name))
  const catalog = renderToolCatalog(deferredEntries())

  return defineAgentTool<z.infer<typeof inputSchema>, ActivateToolsDetails>({
    name: ACTIVATE_TOOLS_TOOL_NAME,
    label: 'Activate tools',
    activeVerb: 'Activating tools',
    description: [
      'Activate plugin or MCP tools by exact name (an MCP tool also by its mcp__server__tool address): their full schemas arrive on the next model turn and stay for the session. A tool already in your tool list is active — call it directly.',
      catalog
        ? `Select at most ${MAX_TOOLS_PER_ACTIVATION} names from this catalog:\n${catalog}`
        : 'No tools remain to activate. Call the tools in your tool list directly.',
    ].join('\n\n'),
    inputSchema,
    // Reveals schemas that were deferred off the wire; it changes what the model can SEE, never
    // anything the model can see. Every revealed tool is still judged on its own call, so
    // confirming the reveal would gate the same action twice — and treating it as a mutation
    // would put read-only plugin/MCP tools out of reach of a run that confirms every write.
    mutates: false,
    executionMode: 'sequential',
    // Runtime adapters use this declarative marker to reveal the activated model schemas.
    activatesTools: true,
    async execute(_toolCallId, input) {
      const activated: string[] = []
      const alreadyActive: string[] = []
      const unknown: string[] = []
      // Requested under another name: the model must call the tool by the name it has.
      const renamed: string[] = []
      const requested = [
        ...new Set(
          input.names.map((raw) => {
            const name = raw.trim()
            const modelNamed = nameByModelName.get(name)
            if (modelNamed) return modelNamed
            // `mcp__server__tool` names the tool whose own name is `mcp_server_tool`.
            const address = normalizeMcpToolAlias(name)
            const own = availableByName.has(name)
              ? name
              : (nameByAlias.get(name) ??
                (address && availableByName.has(address) ? address : undefined))
            if (own && shown(own) !== name) renamed.push(`${name} is ${shown(own)}`)
            return own ?? name
          }),
        ),
      ]

      for (const name of requested) {
        if (!availableByName.has(name)) {
          unknown.push(name)
          continue
        }
        if (active.has(name)) {
          alreadyActive.push(name)
          continue
        }
        active.add(name)
        activated.push(name)
      }

      const lines: string[] = []
      if (activated.length > 0) {
        const released = await options.onActivated?.(activated)
        if (released?.length) {
          // Report it as part of the same answer: the model is deciding what to call next right here.
          lines.push(
            `Released to stay within this session's tool budget: ${released.map(shown).join(', ')}. ` +
              'Activate again if you still need it.',
          )
          for (const name of released) active.delete(name)
        }
        lines.push(
          `Activated: ${activated.map(shown).join(', ')}. Their full schemas will be available on the next model turn, ` +
            'and stay available for the rest of this session — do not activate them again.',
        )
      }
      if (renamed.length > 0) {
        lines.push(`Call these by their names here: ${[...new Set(renamed)].join('; ')}.`)
      }
      if (alreadyActive.length > 0) {
        lines.push(
          `Already active in this session: ${alreadyActive.map(shown).join(', ')}. Call them directly.`,
        )
      }
      if (unknown.length > 0) {
        lines.push(`Unknown tool names: ${unknown.join(', ')}.`)
        lines.push('Current available tools (copy names exactly):')
        lines.push(renderToolCatalog(deferredEntries()))
      }

      return {
        content: lines.join('\n\n'),
        details: {
          activated,
          alreadyActive,
          unknown,
          available: deferredEntries().map((entry) => entry.tool.name),
        },
      }
    },
  })
}
