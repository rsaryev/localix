import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_MARKETPLACE_PATH,
  parseMarketplaceSource,
  readMarketplace as readCatalog,
  resolveRename,
  type Marketplace,
  type MarketplaceEntry,
  type MarketplaceSource,
} from '@rsaryev/llx-plugin/marketplace'
import { issueLine } from '../catalog/read-folder'

/**
 * A marketplace's `marketplace.json`, read by the kit (`readMarketplace`): an error in a top-level
 * field or the name refuses the catalog, an entry with an error is left out alone. Localix keeps
 * which folder holds it and where it was added from; everything about the format is the kit's.
 */

export type { Marketplace, MarketplaceEntry, PluginSource } from '@rsaryev/llx-plugin/marketplace'

/** Where a marketplace was added from, as the kit reads a recorded `source` (`{ source: 'github', … }`). */
export const marketplaceOrigin = (recorded: unknown): MarketplaceSource | undefined =>
  parseMarketplaceSource(recorded, { policy: false }).source

/** A parsed catalog, or why it cannot load: its blocking issues, one per line. */
export function parseMarketplace(raw: unknown, recordedSource?: unknown): Marketplace {
  const origin = recordedSource === undefined ? undefined : marketplaceOrigin(recordedSource)
  const read = readCatalog(raw, origin === undefined ? {} : { origin })
  if (read.marketplace) return read.marketplace
  const errors = read.issues.filter((one) => one.severity === 'error').map(issueLine)
  throw new Error(`Invalid marketplace.json: ${errors.join('; ') || 'it does not load'}`)
}

/** The catalog in `dir` as written, at Claude Code's `.claude-plugin/marketplace.json`. */
export async function readCatalogJson(dir: string): Promise<unknown> {
  const file = join(dir, DEFAULT_MARKETPLACE_PATH)
  const text = await fs.readFile(file, 'utf8').catch(() => {
    throw new Error(`No ${DEFAULT_MARKETPLACE_PATH} found in ${dir}`)
  })
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`Invalid marketplace.json: ${file} is not JSON`)
  }
}

/** The catalog in `dir`, read by the kit. */
export const readMarketplace = async (
  dir: string,
  recordedSource?: unknown,
): Promise<Marketplace> => parseMarketplace(await readCatalogJson(dir), recordedSource)

/**
 * The name a request for `requested` installs under the catalog's `renames` (`resolveRename`): the
 * listed plugin, its successor, or a refusal for a removed one. A name the catalog neither lists
 * nor renames comes back as it is, for the caller to report as missing.
 */
export function resolveEntryName(
  market: Marketplace,
  requested: string,
): { name: string; renamedFrom?: string } {
  const status = resolveRename(requested, market)
  if (status.status === 'renamed') return { name: status.to, renamedFrom: requested }
  if (status.status === 'removed')
    throw new Error(`Plugin "${requested}" was removed from marketplace "${market.name}".`)
  return { name: requested }
}

/** True when the catalog lists `name` or renames it (a request for it resolves or explains). */
export const catalogKnows = (market: Marketplace, name: string): boolean =>
  market.plugins.some((entry) => entry.name === name) || Object.hasOwn(market.renames, name)

/** The entry's folder inside the marketplace, for a relative source. */
export const relativeEntryPath = (entry: MarketplaceEntry): string | undefined =>
  entry.source.kind === 'relative' ? entry.source.path : undefined
