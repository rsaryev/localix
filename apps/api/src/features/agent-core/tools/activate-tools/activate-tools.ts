import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { ACTIVATE_TOOLS_TOOL_NAME } from '../../tool-names'

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
    .describe('Exact tool names copied from the available-tools catalog.'),
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

/** Stable, compact catalog shown to the model instead of full parameter schemas. */
export function renderToolCatalog(entries: readonly DeferredToolEntry[]): string {
  return [...entries]
    .sort((a, b) => a.tool.name.localeCompare(b.tool.name))
    .map(
      (entry) =>
        `- ${entry.tool.name} [${entry.source}]: ${shortDescription(entry.tool.description)}`,
    )
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
      'Activate plugin or MCP tools by exact name: their full schemas arrive on the next model turn and stay for the session. A tool already in your tool list is active — call it directly.',
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
      const requested = [...new Set(input.names.map((name) => name.trim()))]
      const activated: string[] = []
      const alreadyActive: string[] = []
      const unknown: string[] = []

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
            `Released to stay within this session's tool budget: ${released.join(', ')}. ` +
              'Activate again if you still need it.',
          )
          for (const name of released) active.delete(name)
        }
        lines.push(
          `Activated: ${activated.join(', ')}. Their full schemas will be available on the next model turn, ` +
            'and stay available for the rest of this session — do not activate them again.',
        )
      }
      if (alreadyActive.length > 0) {
        lines.push(
          `Already active in this session: ${alreadyActive.join(', ')}. Call them directly.`,
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
