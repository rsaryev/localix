import { relative } from 'node:path'

import {
  COMMUNITY_SOURCE,
  gitOrigin,
  npmOrigin,
  type Listing,
  type StoreInstall,
  type StoreJob,
  type Trust,
} from '@localixai/store'

import { defaultMarketplaceOf } from './default-marketplaces'
import type { Marketplace, MarketplaceEntry } from './marketplace'
import type { KnownMarketplace } from './marketplace-catalog'
import { resolveEntrySource } from './marketplace-entry-source'
import type { PluginContents } from './store-contents'
import { marketPicks } from './store-editorial'

/**
 * HOW A PLUGIN LOOKS IN THE STORE: one marketplace entry projected into the Store's contract
 * (`docs/internals/store.md`), with every field the entry gives — display name, author, category,
 * tags, version, homepage — and the trust of its marketplace: a default source's
 * (`@localixai/store`), or community for one the person added.
 */

export interface MarketView {
  name: string
  record: KnownMarketplace
  market: Marketplace
  trust: Trust
  weight: number
  editorial: boolean
  label: string
}

const LABELS: Record<string, string> = {
  localix: 'Localix',
  'claude-plugins-official': 'Claude plugins',
  'claude-community': 'Claude community',
}

export function marketView(name: string, record: KnownMarketplace, market: Marketplace) {
  const known = defaultMarketplaceOf(name, record.source)
  const { trust, weight, editorial } = known?.entry ?? COMMUNITY_SOURCE
  return {
    name,
    record,
    market,
    trust,
    weight,
    editorial,
    label: LABELS[known?.id ?? ''] ?? name,
  } satisfies MarketView
}

const nameOf = (who: Marketplace['owner']) => (typeof who === 'string' ? who : who?.name)

/** Where the marketplace's own repository is, for an entry that lives inside it. */
function repositoryOf(record: KnownMarketplace): string | null {
  const { source } = record
  if (source.source === 'github') return source.repo
  if (source.source === 'git') return source.url
  return null
}

/** The entry's normalized origin (`identity.ts`), or none when it cannot be resolved. */
export function entryOrigin(view: MarketView, entry: MarketplaceEntry): string | undefined {
  try {
    const at = resolveEntrySource(view.record.installLocation, entry, {
      pluginRoot: view.market.metadata?.pluginRoot,
    })
    if ('localPath' in at) {
      const path = relative(view.record.installLocation, at.localPath)
      const repo = repositoryOf(view.record)
      return repo ? gitOrigin({ url: repo, path }) : `marketplace:${view.name}#${path}`
    }
    if ('git' in at) {
      // A branch or tag names the package; a pinned commit (`sha`) is one version of it.
      const ref = (entry.source as { ref?: unknown }).ref
      return gitOrigin({
        url: at.git.url,
        ...(at.git.subdir ? { path: at.git.subdir } : {}),
        ...(typeof ref === 'string' && ref ? { ref } : {}),
      })
    }
    if ('npm' in at) return npmOrigin(at.npm.package)
    return `archive:${at.archive.url}`
  } catch {
    return undefined
  }
}

const countsOf = (contents: PluginContents) => {
  const counts: Partial<Record<string, number>> = {}
  for (const part of contents.components) counts[part.kind] = (counts[part.kind] ?? 0) + 1
  return counts as Exclude<Listing['contents'], 'unknown'>
}

/** An editorial marketplace's word on an entry: its picks name it, or the entry sets the flag. */
const flag = (view: MarketView, entry: MarketplaceEntry, key: 'featured' | 'recommended') =>
  view.editorial &&
  (marketPicks(view)[key].has(entry.name) || (entry as Record<string, unknown>)[key] === true)

export function pluginListing(
  view: MarketView,
  entry: MarketplaceEntry,
  state: {
    contents?: PluginContents
    installs: StoreInstall[]
    job?: StoreJob
    configurable?: boolean
  },
): Listing {
  const id = `${entry.name}@${view.name}`
  const keywords = (entry as Record<string, unknown>).keywords
  const tags = [
    ...(entry.tags ?? []),
    ...(Array.isArray(keywords)
      ? keywords.filter((word): word is string => typeof word === 'string')
      : []),
  ]
  const origin = entryOrigin(view, entry)
  return {
    ref: { kind: 'plugin', id },
    name: entry.name,
    displayName: entry.displayName ?? entry.name,
    summary: entry.description ?? '',
    ...(entry.category ? { category: entry.category } : {}),
    tags: [...new Set(tags)],
    publisher: {
      name: nameOf(entry.author) ?? nameOf(view.market.owner) ?? view.name,
      verified: view.trust !== 'community',
    },
    source: { id: view.name, label: view.label, trust: view.trust, weight: view.weight },
    ...(entry.version ? { version: entry.version } : {}),
    ...(entry.homepage ? { homepage: entry.homepage } : {}),
    ...(origin ? { origin } : {}),
    contents: state.contents ? countsOf(state.contents) : 'unknown',
    ...(state.contents ? { components: state.contents.components } : {}),
    runsCode: state.contents ? state.contents.runs.length > 0 : 'unknown',
    featured: flag(view, entry, 'featured'),
    recommended: flag(view, entry, 'recommended'),
    installs: state.installs,
    ...(state.job ? { job: state.job } : {}),
    ...(state.configurable ? { configurable: true } : {}),
  }
}
