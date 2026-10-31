import {
  COMMUNITY_SOURCE,
  defaultSource,
  miniAppOrigin,
  type ComponentKind,
  type Listing,
  type ListingDetail,
  type StoreComponent,
} from '@localixai/store'

import { normalizeMiniAppSurfaces } from './contracts-base'
import type { MiniAppMarketplaceSource } from './marketplaces'
import type { MiniAppStorePage } from './store-detail'
import type { MiniAppStoreEntry } from './store-entry'

/**
 * HOW A MINI APP LOOKS IN THE STORE: its marketplace's entry projected into the Store's contract
 * (`docs/internals/store.md`). What it contains is read from what the marketplace already says —
 * its surfaces and commands — so nothing is downloaded to list it: a `workbench` surface is a
 * screen, the `agent` surface is tools its backend gives the agent, and that backend is code that
 * runs.
 */

/** What the Store calls a marketplace: a built-in one's label, or the name it calls itself. */
export function marketplaceLabel(
  source: Pick<MiniAppMarketplaceSource, 'name' | 'builtIn' | 'id'>,
): string {
  return source.builtIn ? (builtInSource(source.id)?.label ?? source.name) : source.name
}

const hasBackend = (entry: MiniAppStoreEntry) =>
  normalizeMiniAppSurfaces(entry.surfaces).includes('agent')

function contentsOf(entry: MiniAppStoreEntry): Partial<Record<ComponentKind, number>> {
  const surfaces = normalizeMiniAppSurfaces(entry.surfaces)
  const contents: Partial<Record<ComponentKind, number>> = {}
  if (surfaces.includes('workbench')) contents.screen = 1
  if (surfaces.includes('agent')) {
    contents['agent-tool'] = 1
    contents.backend = 1
  }
  if (entry.commands?.length) contents.command = entry.commands.length
  return contents
}

/** The default source a built-in marketplace is (`@localixai/store`): Localix's own unless named. */
const builtInSource = (sourceId?: string) => defaultSource(sourceId ?? 'localix-mini-apps')

/**
 * How far a marketplace is trusted: a built-in one is its default source's entry — Localix's own
 * `localix` and editorial, Localix Community's `community` — and one the person added is
 * community; neither community one's curation reaches the Store.
 */
export function marketplaceTrust(source: Pick<MiniAppMarketplaceSource, 'builtIn' | 'id'>) {
  const own = source.builtIn ? builtInSource(source.id) : undefined
  return own ? { trust: own.trust, weight: own.weight, editorial: own.editorial } : COMMUNITY_SOURCE
}

export function miniAppListing(
  entry: MiniAppStoreEntry,
  context: {
    /** The marketplace that offers it; absent for an app the person made. */
    marketplace?: Pick<MiniAppMarketplaceSource, 'name' | 'builtIn' | 'id'>
    enabled: boolean
    configurable?: boolean
    /** The person keeps it from updating on its own (`auto-update.ts`). */
    autoUpdateOff?: boolean
  },
): Listing {
  const { marketplace } = context
  const { trust, weight, editorial } = marketplace
    ? marketplaceTrust(marketplace)
    : { ...COMMUNITY_SOURCE, editorial: false }
  const sourceLabel = marketplace ? marketplaceLabel(marketplace) : OWN_SOURCE.label
  const displayName = entry.displayName ?? entry.name
  const updateTo = entry.update && !entry.incompatible ? entry.version : undefined
  return {
    ref: { kind: 'mini-app', id: entry.id },
    name: entry.name,
    displayName,
    summary: entry.description,
    ...(entry.icon ? { icon: entry.icon } : {}),
    ...(entry.category ? { category: entry.category } : {}),
    tags: entry.tags ?? [],
    publisher: entry.publisher,
    source: { id: entry.source, label: sourceLabel, trust, weight },
    ...(entry.from ? { origin: miniAppOrigin(entry.from, entry.name) } : {}),
    ...(entry.version ? { version: entry.version } : {}),
    contents: contentsOf(entry),
    components: miniAppComponents(entry),
    runsCode: hasBackend(entry),
    featured: editorial && (entry.featured ?? false),
    recommended: editorial && (entry.installByDefault ?? false),
    ...(editorial && entry.suggestFor ? { suggestFor: entry.suggestFor } : {}),
    ...(entry.opens ? { opens: entry.opens } : {}),
    installs: entry.installed
      ? [
          {
            scope: 'user',
            ...(entry.installed.version ? { version: entry.installed.version } : {}),
            enabled: context.enabled,
            ...(updateTo ? { updateTo } : {}),
          },
        ]
      : [],
    ...(entry.job ? { job: { action: entry.installed ? 'update' : 'install', ...entry.job } } : {}),
    ...(entry.incompatible
      ? { incompatible: 'Needs a newer Localix' }
      : entry.nameTaken
        ? { incompatible: entry.nameTaken }
        : {}),
    ...(entry.revoked ? { revoked: entry.revoked } : {}),
    ...(entry.installed && context.configurable ? { configurable: true } : {}),
    ...(entry.signature ? { signature: entry.signature } : {}),
    // Only an app from a signed marketplace updates on its own (`store.ts`, `updateInstalled`).
    ...(entry.installed && entry.signature === 'signed'
      ? { autoUpdate: !context.autoUpdateOff }
      : {}),
  }
}

/** Where a mini app the person made comes from: no marketplace, this computer. */
export const OWN_SOURCE = { id: 'own', label: 'Made on this computer' }

/** What the Store reads of an installed app that no marketplace offers as itself. */
export interface OwnMiniApp {
  name: string
  /** A marketplace installed it (its install record); absent, the person made it. */
  installedFrom?: { marketplace: string; publisher: { name: string; verified: boolean } }
  /** Why its marketplace took it back. */
  revoked?: string
  displayName?: string
  version?: string
  description?: string
  icon?: string
  /** Where it lives, read from its manifest (`miniAppWebsite`): its page links there. */
  homepage?: string
  surfaces?: string[]
  commands?: string[]
}

/**
 * The row of an installed app no marketplace offers as itself: one the person made (installed
 * from their own folder by the authoring plugin, or copied into `~/.localix/mini-apps`), or one a
 * marketplace installed and no longer offers — taken back, or the marketplace removed — which is
 * still that marketplace's. Installed, with nothing to install.
 */
export function ownMiniAppEntry(app: OwnMiniApp): MiniAppStoreEntry {
  const from = app.installedFrom
  return {
    id: app.name,
    name: app.name,
    ...(from ? { marketplace: from.marketplace } : {}),
    ...(app.displayName ? { displayName: app.displayName } : {}),
    description: app.description ?? '',
    ...(app.version ? { version: app.version } : {}),
    ...(app.icon ? { icon: app.icon } : {}),
    publisher: from?.publisher ?? { name: 'You', verified: false },
    source: from ? from.marketplace : OWN_SOURCE.id,
    ...(app.revoked ? { revoked: app.revoked } : {}),
    surfaces: app.surfaces ?? [],
    commands: app.commands ?? [],
    installed: app.version ? { version: app.version } : {},
    update: false,
  }
}

/** What installing it adds: its screen, the agent's tools and backend, and its commands. */
export function miniAppComponents(entry: MiniAppStoreEntry): StoreComponent[] {
  const surfaces = normalizeMiniAppSurfaces(entry.surfaces)
  const label = entry.displayName ?? entry.name
  return [
    ...(surfaces.includes('workbench')
      ? [{ kind: 'screen' as const, name: label, description: 'A screen of its own' }]
      : []),
    ...(surfaces.includes('agent')
      ? [
          { kind: 'agent-tool' as const, name: 'Agent tools', description: 'Tools for the agent' },
          { kind: 'backend' as const, name: label, description: 'Runs on this computer' },
        ]
      : []),
    ...(entry.commands ?? []).map((command) => ({
      kind: 'command' as const,
      name: `/${entry.name}:${command}`,
    })),
  ]
}

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function miniAppDetail(
  listing: Listing,
  page: MiniAppStorePage<MiniAppStoreEntry>,
): ListingDetail {
  const { details } = page
  const facts: [string, string | undefined][] = [
    ['Version', details.version],
    ['Size', details.size ? size(details.size) : undefined],
    ['License', details.license],
    ['Author', details.author],
    ['Homepage', details.homepage],
    ['Built for', details.apiVersion ? `Mini app API ${details.apiVersion}` : undefined],
  ]
  return {
    ...listing,
    readme: page.readme,
    media: page.screenshots,
    facts: facts.flatMap(([label, value]) => (value ? [{ label, value }] : [])),
    components: miniAppComponents(page.entry),
  }
}
