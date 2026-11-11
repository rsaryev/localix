import { join } from 'node:path'

import { COMMUNITY_SOURCE, type SourcePreview } from '@localixai/store'

import { InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { rmrf } from '../ext/install-tree'
import { defaultMarketplaceOf } from './default-marketplaces'
import { parseMarketplace, readCatalogJson } from './kit'
import { readKnownMarketplaces } from './marketplace-catalog'
import { materializeMarketplace } from './marketplace-materialize'
import type { MarketplaceRegistryDeps } from './marketplace-registry'
import { hashString, parseMarketplaceInput } from './marketplace-source'
import { sameMarketplaceSource } from './marketplace-source-identity'
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
  const source = parseMarketplaceInput(input)
  if ('error' in source) throw new InvalidRequestError('marketplace_bad_source', source.error)
  const staging = join(deps.root, `.preview-${Math.abs(hashString(input))}`)
  try {
    await materializeMarketplace(source, staging, deps)
    const raw = await readCatalogJson(staging)
    const market = parseMarketplace(raw, source)
    const known = await readKnownMarketplaces(deps.root)
    const view = marketView(market.name, { source, installLocation: staging }, raw, market)
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
