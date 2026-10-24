import { z } from 'zod'

import type { PluginValidation } from './contracts'

/**
 * Plugin marketplace (`.localix-plugin/marketplace.json`).
 *
 * A marketplace is a curated catalog of plugin ENTRIES, each pointing at a `source`
 * (a relative `./path` inside the marketplace repo, or an object describing a remote
 * git/github/url/npm source). Registered marketplaces live under
 * `~/.localix/marketplaces/<name>/` and are tracked in `known.json`.
 *
 * The entry shape follows the widely used catalog schema (so our bundled `plugins/`
 * catalog stays familiar to authors), validated leniently at parse time + deterministically by
 * {@link validateMarketplace}, which separates blocking schema and source-path errors
 * from non-blocking catalog-hygiene warnings.
 */

/** A plugin entry's source: a relative `./path` string, or an object `{ source, … }`. */

/** An author or owner: a name, or Claude Code's `{ name, email, url }`. */
const marketplaceAuthorSchema = z.union([
  z.string(),
  z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    url: z.string().optional(),
  }),
])

export const marketplaceSourceSchema = z.union([
  z.string(),
  z.object({ source: z.string() }).passthrough(),
])

/**
 * CC 2.1.152+ `relevance` hints on an entry — signals a client MAY use to suggest the
 * plugin for a project (file globs / directory names / keywords). We parse and expose
 * them typed (catalog + resolution surfaces); suggestion RANKING is deliberately
 * deferred — no consumer scores these yet.
 */
export const marketplaceRelevanceSchema = z.object({
  filePatterns: z.array(z.string()).optional(),
  directoryNames: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
})
export type MarketplaceRelevance = z.infer<typeof marketplaceRelevanceSchema>

/** One plugin entry in a marketplace catalog. */
export const marketplaceEntrySchema = z
  .object({
    name: z
      .string()
      .min(1, 'Plugin name cannot be empty')
      .refine((n) => !n.includes(' '), 'Plugin name cannot contain spaces — use kebab-case.'),
    source: marketplaceSourceSchema,
    displayName: z.string().optional(),
    description: z.string().optional(),
    author: marketplaceAuthorSchema.optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    version: z.string().optional(),
    homepage: z.string().optional(),
    /** When false, the entry itself provides the manifest (no plugin.json in the folder). */
    strict: z.boolean().optional(),
    /**
     * CC-compatible: override the enable default for this marketplace-distributed plugin.
     * Honored on install when no explicit enable/disable choice is passed by the caller —
     * takes precedence over the plugin's own `plugin.json` `defaultEnabled` field. An
     * explicit caller choice (e.g. `/plugin install` passing `enable: true`) always wins.
     */
    defaultEnabled: z.boolean().optional(),
    /**
     * Component overrides carried inline on the entry (CC marketplace §1.2). Applied on
     * install: a `strict:false` entry whose plugin dir has NO plugin.json acts as the
     * whole manifest (e.g. the `box` skill-bundle, the `*-lsp` LSP plugins); a strict
     * (default) entry SUPPLEMENTS the plugin.json. `skills` add to the default scan;
     * `lspServers` register with the LSP feature. Paths are relative to the plugin dir.
     */
    skills: z.union([z.string(), z.array(z.string())]).optional(),
    lspServers: z.record(z.string(), z.unknown()).optional(),
    relevance: marketplaceRelevanceSchema.optional(),
  })
  // Passthrough so a CC entry's remaining component overrides (commands/agents/hooks/
  // mcpServers…) are preserved rather than stripped — keeping them means the catalog
  // parses gracefully instead of dropping data on a valid entry.
  .passthrough()
export type MarketplaceEntry = z.infer<typeof marketplaceEntrySchema>

/** A marketplace catalog. Unknown top-level keys (e.g. `$schema`) are stripped. */
export const marketplaceSchema = z.object({
  name: z.string().min(1, 'Marketplace name cannot be empty'),
  owner: marketplaceAuthorSchema.optional(),
  description: z.string().optional(),
  plugins: z.array(marketplaceEntrySchema),
  /**
   * CC 2.1.193+ plugin renames: `{ "old-name": "new-name" }` maps a retired entry name
   * to its successor; a `null` value marks the plugin as REMOVED from the marketplace.
   * Applied at resolution time by {@link resolveEntryName}, following the chain.
   */
  renames: z.record(z.string(), z.string().nullable()).optional(),
  /** Uninstall a plugin the catalog no longer lists (and did not rename) on update. */
  forceRemoveDeletedPlugins: z.boolean().optional(),
  /**
   * CC: other marketplaces this catalog's plugins may pull DEPENDENCIES from. A
   * dependency that only exists in a marketplace NOT listed here (and not this one)
   * is rejected at install time — see `dependencies.ts` resolveDependencyPlan.
   */
  allowCrossMarketplaceDependenciesOn: z.array(z.string()).optional(),
  metadata: z
    .object({
      description: z.string().optional(),
      version: z.string().optional(),
      pluginRoot: z.string().optional(),
      /**
       * Localix's own picks for its Store's Discover (`store-editorial.ts`); Claude Code ignores
       * the key. Read leniently there, never a reason to refuse the catalog.
       */
      localix: z.unknown().optional(),
    })
    .optional(),
})
export type Marketplace = z.infer<typeof marketplaceSchema>

/**
 * Apply the catalog's `renames` map to a requested plugin name, following the chain from the
 * oldest name as Claude Code does (host-marketplace.md, "Migrate users with a renames map"): each
 * old name leads to its successor until a name that is not renamed again; a `null` link means the
 * plugin was removed. A chain that cycles does not resolve.
 */
export function resolveEntryName(
  market: Pick<Marketplace, 'name' | 'renames'>,
  requested: string,
): { name: string; renamedFrom?: string } {
  let name = requested
  const seen = new Set<string>([requested])
  for (;;) {
    const mapped = market.renames?.[name]
    if (mapped === undefined) break
    if (mapped === null)
      throw new Error(`Plugin "${requested}" was removed from marketplace "${market.name}".`)
    if (seen.has(mapped))
      throw new Error(
        `renames.${requested}: chain does not resolve (it cycles) in marketplace "${market.name}".`,
      )
    seen.add(mapped)
    name = mapped
  }
  return name === requested ? { name } : { name, renamedFrom: requested }
}

/** Flag a `..` segment in a source path — it can't be installed (escapes the marketplace root). */
function checkSourceTraversal(value: string, where: string, errors: string[]): void {
  if (value.includes('..'))
    errors.push(`${where} contains ".." — sources must stay inside the marketplace root: ${value}`)
}

/** True when one raw entry parses and its source stays inside the marketplace. */
function entryIsUsable(entry: unknown): boolean {
  if (!marketplaceEntrySchema.safeParse(entry).success) return false
  const source = (entry as { source: unknown }).source
  const path = typeof source === 'string' ? source : (source as { path?: unknown } | null)?.path
  return typeof path !== 'string' || !path.includes('..')
}

/**
 * Drop the entries that are invalid on their own (Claude Code: one invalid entry doesn't fail
 * the marketplace). Anything that is not a catalog object passes through for the validator.
 */
export function usableEntries(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { plugins?: unknown }).plugins))
    return raw
  const obj = raw as { plugins: unknown[] }
  return { ...obj, plugins: obj.plugins.filter(entryIsUsable) }
}

/**
 * Deterministically validate a raw (pre-zod) marketplace object — the same kind of
 * check `claude plugin validate` runs, rebuilt for our pipeline. Errors block; warnings
 * are hygiene. Covers: path traversal in entry sources (string + object `path`), schema
 * shape, duplicate entry names, and an empty/owner-less catalog.
 */
export function validateMarketplace(raw: unknown): PluginValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!raw || typeof raw !== 'object') {
    return { errors: ['Marketplace manifest is not a JSON object.'], warnings }
  }
  const obj = raw as Record<string, unknown>

  // Path traversal in plugin sources — checked before schema so security issues
  // surface even when the shape is otherwise wrong.
  if (Array.isArray(obj.plugins)) {
    obj.plugins.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object') return
      const source = (entry as { source?: unknown }).source
      if (typeof source === 'string') checkSourceTraversal(source, `plugins[${i}].source`, errors)
      else if (source && typeof source === 'object') {
        const so = source as Record<string, unknown>
        if (typeof so.path === 'string')
          checkSourceTraversal(so.path, `plugins[${i}].source.path`, errors)
      }
    })
  }

  const parsed = marketplaceSchema.safeParse(obj)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.') || 'root'}: ${issue.message}`)
    }
    return { errors, warnings }
  }

  const market = parsed.data
  // `name`, `owner` and `plugins` are required: Claude Code cannot load a catalog without an owner.
  if (!market.owner) errors.push('owner: Marketplace has no "owner" — add maintainer/curator info.')
  if (market.plugins.length === 0) warnings.push('Marketplace has no plugins defined.')

  const seen = new Set<string>()
  for (const [i, entry] of market.plugins.entries()) {
    if (seen.has(entry.name))
      errors.push(`plugins[${i}].name: duplicate plugin name "${entry.name}" in the marketplace.`)
    seen.add(entry.name)
  }

  // Renames hygiene: a non-null target should exist as an entry; an old name that
  // still has a live entry is shadowed by the rename at resolution time.
  for (const [oldName, newName] of Object.entries(market.renames ?? {})) {
    if (typeof newName === 'string' && !seen.has(newName))
      warnings.push(`renames.${oldName}: target "${newName}" is not a plugin in this marketplace.`)
    if (seen.has(oldName))
      warnings.push(
        `renames.${oldName}: a plugin entry still uses the old name — the rename shadows it at resolution.`,
      )
  }

  return { errors, warnings }
}

// The bundled-catalog generator lives in its own module; re-exported so existing
// importers (tests) keep this surface.
