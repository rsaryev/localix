import type { Marketplace } from './marketplace'

/**
 * Bundled-catalog generation — builds the Claude Code-compatible marketplace.json we
 * commit for our `plugins/` dir (see apps/api/scripts/generate-bundled-marketplace.ts).
 * Split from `./marketplace` (schema + validation) to keep both modules small; the
 * public surface is re-exported there.
 */

/** A plugin summary the generator turns into a marketplace entry. */
export interface MarketplacePluginInput {
  name: string
  description?: string
  version?: string
  author?: string
  homepage?: string
}

/**
 * Build a Claude Code-compatible marketplace manifest for a set of plugins whose
 * folders live directly under the marketplace root (each entry's `source` is the
 * relative `./<name>`). Used to emit a catalog for our bundled `plugins/` dir.
 */
export function buildMarketplaceManifest(opts: {
  name: string
  description?: string
  owner?: { name?: string; email?: string; url?: string }
  plugins: MarketplacePluginInput[]
  renames?: Record<string, string | null>
}): Marketplace & { $schema: string } {
  return {
    $schema: 'https://json.schemastore.org/claude-code-marketplace.json',
    name: opts.name,
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.owner ? { owner: opts.owner } : {}),
    ...(opts.renames ? { renames: opts.renames } : {}),
    plugins: opts.plugins.map((p) => ({
      name: p.name,
      source: `./${p.name}`,
      ...(p.description ? { description: p.description } : {}),
      ...(p.version ? { version: p.version } : {}),
      ...(p.author ? { author: p.author } : {}),
      ...(p.homepage ? { homepage: p.homepage } : {}),
    })),
  }
}
