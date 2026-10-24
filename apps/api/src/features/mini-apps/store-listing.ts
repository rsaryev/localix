import type { ComponentKind, Listing, ListingDetail, StoreComponent } from '@localixai/store'
import { capabilitySettingsUiUri } from '@localixai/uri'

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

export function miniAppListing(
  entry: MiniAppStoreEntry,
  context: { sourceLabel: string; enabled: boolean },
): Listing {
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
    source: { id: entry.source, label: context.sourceLabel },
    ...(entry.version ? { version: entry.version } : {}),
    contents: contentsOf(entry),
    ...(entry.commands?.length ? { componentNames: entry.commands } : {}),
    runsCode: hasBackend(entry),
    featured: entry.featured ?? false,
    recommended: entry.recommended ?? false,
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
    ...(entry.installed
      ? { configure: capabilitySettingsUiUri({ kind: 'mini-app', id: entry.name, scope: '' }) }
      : {}),
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
