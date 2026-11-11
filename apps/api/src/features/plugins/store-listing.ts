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
import {
  catalogAt,
  type KnownMarketplace,
  type Marketplace,
  type MarketplaceEntry,
  parseMarketplace,
  resolveEntrySource,
} from './kit'
import type { PluginContents } from './store-contents'
import { entryCuration } from './store-editorial'

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
  /** The catalog as written, for the keys only Localix reads (`store-editorial.ts`). */
  raw: unknown
  trust: Trust
  weight: number
  editorial: boolean
  label: string
}

export function marketView(
  name: string,
  record: KnownMarketplace,
  raw: unknown,
  market: Marketplace = parseMarketplace(raw, record.source),
) {
  const known = defaultMarketplaceOf(name, record.source)
  const { trust, weight, editorial } = known?.entry ?? COMMUNITY_SOURCE
  return {
    name,
    record,
    market,
    raw,
    trust,
    weight,
    editorial,
    label: known?.entry.label ?? name,
  } satisfies MarketView
}

/** Where the marketplace's own repository is, for an entry that lives inside it. */
function repositoryOf(record: KnownMarketplace): string | null {
  const { source } = record
  if (source.kind === 'github') return source.repo
  if (source.kind === 'git') return source.url
  return null
}

/** The entry's normalized origin (`identity.ts`), or none when it cannot be resolved. */
export function entryOrigin(view: MarketView, entry: MarketplaceEntry): string | undefined {
  try {
    const { root } = catalogAt(view.record)
    const at = resolveEntrySource(root, entry, view.record.source)
    if ('localPath' in at) {
      const path = relative(root, at.localPath)
      const repo = repositoryOf(view.record)
      return repo ? gitOrigin({ url: repo, path }) : `marketplace:${view.name}#${path}`
    }
    if ('git' in at) {
      // A branch or tag names the package; a pinned commit (`sha`) is one version of it.
      const ref = 'ref' in entry.source ? entry.source.ref : undefined
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
  const tags = [...(entry.tags ?? []), ...(entry.display.keywords ?? [])]
  const origin = entryOrigin(view, entry)
  const curation = entryCuration(view, entry)
  return {
    ref: { kind: 'plugin', id },
    name: entry.name,
    displayName: entry.displayName ?? entry.name,
    summary: entry.description ?? '',
    ...(entry.category ? { category: entry.category } : {}),
    tags: [...new Set(tags)],
    publisher: {
      name: entry.display.author?.name ?? view.market.owner.name,
      verified: view.trust !== 'community',
    },
    source: { id: view.name, label: view.label, trust: view.trust, weight: view.weight },
    ...(entry.version ? { version: entry.version } : {}),
    ...(entry.display.homepage ? { homepage: entry.display.homepage } : {}),
    ...(origin ? { origin } : {}),
    ...(curation.suggestFor ? { suggestFor: curation.suggestFor } : {}),
    contents: state.contents ? countsOf(state.contents) : 'unknown',
    ...(state.contents ? { components: state.contents.components } : {}),
    runsCode: state.contents ? state.contents.runs.length > 0 : 'unknown',
    featured: curation.featured === true,
    // The Store's starters: what a new installation installs on its own (`installByDefault`).
    recommended: curation.installByDefault === true,
    installs: state.installs,
    ...(state.job ? { job: state.job } : {}),
    ...(state.configurable ? { configurable: true } : {}),
  }
}
