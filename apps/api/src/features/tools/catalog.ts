import { z } from 'zod'
import type { AgentToolCategory } from '@localixai/agent/agents'
import { BUILTIN_TOOL_CATALOG } from '../agent-core/tool-names'
import { pluginLabel } from '@localixai/plugin-sdk/manifest'

export const CATEGORY_LABELS = {
  core: 'Core',
  filesystem: 'File system',
  knowledge: 'Knowledge & memory',
  automation: 'Automation',
  ui: 'UI',
} as const satisfies Record<AgentToolCategory, string>

/**
 * The category vocabulary, DERIVED from the label table above rather than restated:
 * a new `AgentToolCategory` fails to compile in `CATEGORY_LABELS` and reaches the wire
 * schema for free instead of silently becoming an invalid enum member.
 */
const TOOL_CATEGORIES = Object.keys(CATEGORY_LABELS) as [AgentToolCategory, ...AgentToolCategory[]]

/**
 * Settings/API projection of one tool. Zod owns it (and `ToolMeta` is inferred from
 * it) because the capability snapshot parses its response — an interface here plus a
 * schema there is the drift this file's callers cannot afford.
 */
export const toolMetaSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  category: z.enum(TOOL_CATEGORIES),
  /** Present only for a tool contributed by a plugin. */
  provider: z.object({ kind: z.literal('plugin'), id: z.string(), label: z.string() }).optional(),
})
export type ToolMeta = z.infer<typeof toolMetaSchema>

/** Minimum plugin projection needed to merge its live tool descriptors. */
export interface ToolCatalogPluginSource {
  name: string
  displayName?: string
  enabled: boolean
  provides: {
    tools: readonly {
      name: string
      label: string
      description: string
    }[]
  }
}

/**
 * One catalog tool plus WHY it cannot be dispatched, decided before any
 * settings policy runs.
 *
 * A tool contributed by a DISABLED plugin used to simply vanish from the catalog,
 * which is why Settings could show a stale "N/M tools enabled" and a user had no way
 * to learn that the tool they were looking for went away with its plugin. Keeping the
 * entry and naming the owner turns that silence into an explanation.
 */
export interface ToolCatalogEntry {
  meta: ToolMeta
  /** Set when the tool exists in the scope but is NOT in the run's roster. */
  unavailableReason?: string
}

/**
 * Settings/API projection of the same catalog the runtime vocabulary uses.
 *
 * Field by field, NOT a spread. The catalog also carries run policy the settings wire has no
 * business publishing — `exposure` is which run shapes may hold the tool, answered per run by
 * the ledger — and a spread put it on the wire the moment it was added, silently. Naming the
 * four published fields makes the next catalog field a deliberate decision instead.
 */
export function builtinToolManifest(): ToolMeta[] {
  return Object.values(BUILTIN_TOOL_CATALOG).map(({ name, label, description, category }) => ({
    name,
    label,
    description,
    category,
  }))
}

/**
 * THE tool catalog for one scope: built-ins plus every plugin-contributed tool,
 * each tagged with whether its owner is currently enabled.
 *
 * Enabled plugins are merged FIRST so the runtime's first-owner-wins name rule is
 * unchanged — a disabled plugin can never take a name from an enabled one, whatever
 * order discovery happened to return them in.
 *
 * Note that a disabled plugin usually reports NO tools: descriptors come from
 * importing the plugin's entrypoint, which the trust gate only does while it is
 * enabled (see `service.toRecord`). So `unavailableReason` fires for the tools we can
 * still name — a plugin whose descriptors were already inspected, or one that
 * declares them in its manifest — and a plugin that was never imported simply
 * contributes nothing, exactly as before.
 */
export function toolCatalogEntries(
  plugins: readonly ToolCatalogPluginSource[],
): ToolCatalogEntry[] {
  const entries: ToolCatalogEntry[] = builtinToolManifest().map((meta) => ({ meta }))
  const names = new Set(entries.map(({ meta }) => meta.name))
  const merge = (plugin: ToolCatalogPluginSource) => {
    for (const descriptor of plugin.provides.tools) {
      if (names.has(descriptor.name)) continue
      names.add(descriptor.name)
      entries.push({
        meta: {
          ...descriptor,
          category: 'automation',
          provider: {
            kind: 'plugin',
            id: plugin.name,
            label: pluginLabel(plugin),
          },
        },
        ...(plugin.enabled
          ? {}
          : {
              unavailableReason: `provided by disabled plugin "${pluginLabel(plugin)}"`,
            }),
      })
    }
  }
  for (const plugin of plugins) if (plugin.enabled) merge(plugin)
  for (const plugin of plugins) if (!plugin.enabled) merge(plugin)
  return entries
}

/** Merge core and live plugin descriptors, keeping the runtime's first-owner-wins rule. */
export function toolManifest(plugins: readonly ToolCatalogPluginSource[]): ToolMeta[] {
  return toolCatalogEntries(plugins).flatMap((entry) =>
    entry.unavailableReason ? [] : [entry.meta],
  )
}

export function toolCatalogNames(plugins: readonly ToolCatalogPluginSource[]): string[] {
  return toolManifest(plugins).map(({ name }) => name)
}
