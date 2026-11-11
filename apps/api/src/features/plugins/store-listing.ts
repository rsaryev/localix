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
  cloneUrl,
  entryFetchPlan,
  localEntryDir,
  type KnownMarketplace,
  parseMarketplace,
} from './kit'
import type { Marketplace, MarketplaceEntry } from '@rsaryev/llx-plugin/marketplace'
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
  /** The catalog as written, for each entry's `localix` key, which the kit does not keep (`store-editorial.ts`). */
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
    const plan = entryFetchPlan(entry, view.record.source)
    if (plan.kind === 'local') {
      const path = relative(root, localEntryDir(root, entry, plan))
      const repo = repositoryOf(view.record)
      return repo ? gitOrigin({ url: repo, path }) : `marketplace:${view.name}#${path}`
    }
    if (plan.kind === 'git')
      // A branch or tag names the package; a pinned commit (`sha`) is one version of it.
      return gitOrigin({
        url: cloneUrl(plan.repo),
        ...(plan.subdir ? { path: plan.subdir } : {}),
        ...(plan.ref ? { ref: plan.ref } : {}),
      })
    if (plan.kind === 'npm')
      return npmOrigin('package' in plan.spec ? plan.spec.package : plan.spec.tarballUrl)
    return `archive:${plan.url}`
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
