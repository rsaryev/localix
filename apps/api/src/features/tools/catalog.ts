import { z } from 'zod'
import type { AgentToolCategory } from '@localixai/agent/agents'
import { BUILTIN_TOOL_CATALOG, isProtocolTool } from '../agent-core/tool-names'
import { miniAppLabel } from '@localixai/mini-app-sdk/manifest'

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
  /** Required by the conversation protocol; it has no off switch. */
  required: z.boolean().optional(),
  /** Present only for a tool contributed by a mini app's backend. */
  provider: z.object({ kind: z.literal('mini-app'), id: z.string(), label: z.string() }).optional(),
})
export type ToolMeta = z.infer<typeof toolMetaSchema>

/** Minimum mini app projection needed to merge its live tool descriptors. */
export interface ToolCatalogMiniAppSource {
  name: string
  displayName?: string
  enabled: boolean
  tools: readonly {
    name: string
    label: string
    description: string
  }[]
}

/**
 * One catalog tool plus WHY it cannot be dispatched, decided before any
 * settings policy runs.
 *
 * A tool contributed by a DISABLED mini app used to simply vanish from the catalog,
 * which is why Settings could show a stale "N/M tools enabled" and a user had no way
 * to learn that the tool they were looking for went away with its mini app. Keeping the
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
    ...(isProtocolTool(name) ? { required: true } : {}),
  }))
}

/**
 * THE tool catalog for one scope: built-ins plus every tool a mini app backend contributes,
 * each tagged with whether its owner is currently enabled.
 *
 * Enabled mini apps are merged FIRST so the runtime's first-owner-wins name rule is
 * unchanged — a disabled mini app can never take a name from an enabled one, whatever
 * order discovery happened to return them in.
 *
 * Note that a disabled mini app usually reports NO tools: descriptors come from
 * importing the mini app's backend, which the trust gate only does while it is
 * enabled (see `service.toRecord`). So `unavailableReason` fires for the tools we can
 * still name — a mini app whose descriptors were already inspected, or one that
 * declares them in its manifest — and a mini app that was never imported simply
 * contributes nothing, exactly as before.
 */
export function toolCatalogEntries(
  miniApps: readonly ToolCatalogMiniAppSource[],
): ToolCatalogEntry[] {
  const entries: ToolCatalogEntry[] = builtinToolManifest().map((meta) => ({ meta }))
  const names = new Set(entries.map(({ meta }) => meta.name))
  const merge = (app: ToolCatalogMiniAppSource) => {
    for (const descriptor of app.tools) {
      if (names.has(descriptor.name)) continue
      names.add(descriptor.name)
      entries.push({
        meta: {
          ...descriptor,
          category: 'automation',
          provider: {
            kind: 'mini-app',
            id: app.name,
            label: miniAppLabel(app),
          },
        },
        ...(app.enabled
          ? {}
          : {
              unavailableReason: `provided by disabled mini app "${miniAppLabel(app)}"`,
            }),
      })
    }
  }
  for (const app of miniApps) if (app.enabled) merge(app)
  for (const app of miniApps) if (!app.enabled) merge(app)
  return entries
}

/** Merge core and live mini app descriptors, keeping the runtime's first-owner-wins rule. */
export function toolManifest(miniApps: readonly ToolCatalogMiniAppSource[]): ToolMeta[] {
  return toolCatalogEntries(miniApps).flatMap((entry) =>
    entry.unavailableReason ? [] : [entry.meta],
  )
}

export function toolCatalogNames(miniApps: readonly ToolCatalogMiniAppSource[]): string[] {
  return toolManifest(miniApps).map(({ name }) => name)
}
