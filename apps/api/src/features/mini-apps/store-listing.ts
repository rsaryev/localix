import {
  catalogOrigin,
  COMMUNITY_SOURCE,
  defaultSource,
  type ComponentKind,
  type Listing,
  type ListingDetail,
  type StoreComponent,
} from '@localixai/store'

import { normalizeMiniAppSurfaces } from './contracts-base'
import type { MiniAppStorePage } from './store-detail'
import type { MiniAppStoreEntry } from './store-entry'

/**
 * HOW A MINI APP LOOKS IN THE STORE: its catalog entry projected into the Store's contract
 * (`docs/internals/store.md`). What it contains is read from what the catalog already says — its
 * surfaces and commands — so nothing is downloaded to list it: a `workbench` surface is a screen,
 * the `agent` surface is tools its backend gives the agent, and that backend is code that runs.
 */

/** A catalog by where it lives: Localix's own, its host, or a folder on this computer. */
export function catalogLabel(url: string, builtIn: boolean): string {
  if (builtIn) return 'Localix'
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' ? 'A folder on this computer' : parsed.host
  } catch {
    return url
  }
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

/**
 * How far a catalog is trusted: Localix's own is the default source's entry (`localix`, editorial);
 * one the person added is community, and its picks do not reach Discover.
 */
export function catalogTrust(builtIn: boolean) {
  const own = defaultSource('localix-mini-apps')
  return builtIn && own
    ? { trust: own.trust, weight: own.weight, editorial: own.editorial }
    : COMMUNITY_SOURCE
}

export function miniAppListing(
  entry: MiniAppStoreEntry,
  context: { sourceLabel: string; enabled: boolean; builtIn: boolean; configurable?: boolean },
): Listing {
  const { trust, weight, editorial } = catalogTrust(context.builtIn)
  const displayName = entry.displayName ?? entry.name
  const updateTo = entry.update && !entry.incompatible ? entry.version : undefined
  return {
    ref: { kind: 'mini-app', id: entry.name },
    name: entry.name,
    displayName,
    summary: entry.description,
    ...(entry.icon ? { icon: entry.icon } : {}),
    ...(entry.category ? { category: entry.category } : {}),
    tags: entry.tags ?? [],
    publisher: entry.publisher,
    source: { id: entry.source, label: context.sourceLabel, trust, weight },
    origin: catalogOrigin(entry.name),
    ...(entry.version ? { version: entry.version } : {}),
    contents: contentsOf(entry),
    components: miniAppComponents(entry),
    runsCode: hasBackend(entry),
    featured: editorial && (entry.featured ?? false),
    recommended: editorial && (entry.recommended ?? false),
    ...(editorial && entry.suits ? { suits: entry.suits } : {}),
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
    ...(entry.incompatible ? { incompatible: 'Needs a newer Localix' } : {}),
    ...(entry.installed && context.configurable ? { configurable: true } : {}),
  }
}

/** Where a mini app the person made comes from: no catalog, this computer. */
export const OWN_SOURCE = { id: 'own', label: 'Made on this computer' }

/** What the Store reads of an installed app that no catalog offers. */
export interface OwnMiniApp {
  name: string
  displayName?: string
  version?: string
  description?: string
  icon?: string
  surfaces?: string[]
  commands?: string[]
}

/**
 * The row of an app the person made (installed from their own folder by the authoring
 * plugin, or copied into `~/.localix/mini-apps`): installed, with nothing to install.
 */
export function ownMiniAppEntry(app: OwnMiniApp): MiniAppStoreEntry {
  return {
    name: app.name,
    ...(app.displayName ? { displayName: app.displayName } : {}),
    description: app.description ?? '',
    ...(app.version ? { version: app.version } : {}),
    ...(app.icon ? { icon: app.icon } : {}),
    publisher: { name: 'You', verified: false },
    source: OWN_SOURCE.id,
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
