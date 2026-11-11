import { join } from 'node:path'

import { COMMUNITY_SOURCE, type SourcePreview } from '@localixai/store'

import { InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { rmrf } from '../ext/install-tree'
import { defaultMarketplaceOf } from './default-marketplaces'
import {
  isLocalSource,
  parseMarketplace,
  parseMarketplaceAdd,
  readCatalogJson,
  readKnownMarketplaces,
  sameMarketplaceSource,
} from './kit'
import { materializeMarketplace } from './marketplace-materialize'
import type { MarketplaceRegistryDeps } from './marketplace-registry'
import { hashString } from './marketplace-source'
import { marketView } from './store-listing'

/**
 * A MARKETPLACE READ BEFORE IT IS ADDED, for the Store's add dialog: fetched into a staging folder
 * the way `/plugin marketplace add` fetches it, read, and deleted. Nothing is registered.
 */
export async function previewMarketplace(
  input: string,
  deps: Pick<MarketplaceRegistryDeps, 'cloneRepo' | 'root' | 'fetchNpm' | 'managedSettingsDir'> & {
    root: string
  },
): Promise<SourcePreview> {
  const source = parseMarketplaceAdd(input)
  if ('error' in source) throw new InvalidRequestError('marketplace_bad_source', source.error)
  const staging = join(deps.root, `.preview-${Math.abs(hashString(input))}`)
  try {
    // A local marketplace is read where it is, as adding it would read it.
    const at = { source, installLocation: isLocalSource(source) ? source.path : staging }
    if (!isLocalSource(source)) await materializeMarketplace(source, staging, deps)
    const raw = await readCatalogJson(at)
    const market = parseMarketplace(raw, source)
    const known = await readKnownMarketplaces(deps.root)
    const record = { ...at, lastUpdated: new Date().toISOString() }
    const view = marketView(market.name, record, raw, market)
    const publishers = [
      ...market.plugins.map((entry) => entry.display.author?.name),
      market.owner.name,
    ].filter((name): name is string => !!name)
    return {
      kind: 'plugin',
      id: market.name,
      label: view.label,
      publishers: [...new Set(publishers)].slice(0, 5),
      count: market.plugins.length,
      icons: [],
      verified:
        (defaultMarketplaceOf(market.name, source)?.entry ?? COMMUNITY_SOURCE).trust !==
        'community',
      added:
        !!known[market.name] ||
        Object.values(known).some((record) => sameMarketplaceSource(record.source, source)),
    }
  } catch (error) {
    if (error instanceof InvalidRequestError) throw error
    throw new InvalidRequestError(
      'marketplace_preview_failed',
      `That marketplace could not be read (${errorMessage(error)})`,
    )
  } finally {
    await rmrf(staging).catch(() => {})
  }
}
