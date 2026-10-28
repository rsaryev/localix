import {
  COMPONENT_KINDS,
  componentCount,
  hasUpdate,
  onShelf,
  parseShelf,
  shelfCounts,
  type CreateForm,
  type ItemAction,
  type DiscoverResponse,
  type Listing,
  type ListingConfig,
  type ListingDetail,
  type ListingsResponse,
  type PackageKind,
  type Scope,
  type ShelfPlan,
  type SourceView,
  type StoreProblem,
  type ActionResult,
} from '@localixai/store'
import { makeListing } from '@localixai/store/testing'
import type { StorePageQuery } from '@/shared/api/store-client'
import { MonitorDown } from 'lucide-react'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'

export const HOSTED = 'https://hosted.test/mini-app-catalog.json'
export const ADA = 'https://ada.test/mini-app-catalog.json'

export const listing = (over: Partial<Listing> & { id: string }): Listing =>
  makeListing({ source: { id: HOSTED, label: 'Localix', trust: 'localix' }, ...over })

const count = (listings: Listing[], keys: (l: Listing) => (string | undefined)[]) => {
  const counts: Record<string, number> = {}
  for (const l of listings) for (const key of keys(l)) if (key) counts[key] = (counts[key] ?? 0) + 1
  return counts
}

const text = (l: Listing) =>
  [
    l.name,
    l.displayName,
    l.summary,
    ...l.tags,
    ...(l.components ?? []).flatMap((c) => [c.name, c.description ?? '']),
  ]
    .join(' ')
    .toLowerCase()

/** The server's answer for a query, the way the Store's index gives it: one page and a cursor. */
export function answer(listings: Listing[], query: StorePageQuery): ListingsResponse {
  const shelf = parseShelf(query.shelf)
  const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const found = listings.filter(
    (l) =>
      (!shelf || onShelf(l, shelf)) &&
      (!query.category || l.category === query.category) &&
      (!query.source || l.source.id === query.source) &&
      (!query.trust || l.source.trust === query.trust) &&
      (query.installed === undefined || l.installs.length > 0 === query.installed) &&
      words.every((word) => text(l).includes(word)),
  )
  const from = Number(query.cursor ?? 0)
  const limit = query.limit ?? 40
  const next = from + limit < found.length ? String(from + limit) : undefined
  return {
    listings: found.slice(from, from + limit),
    facets: {
      shelves: shelfCounts(listings),
      kind: count(found, (l) => [l.ref.kind]),
      component: count(found, (l) => COMPONENT_KINDS.filter((k) => componentCount(l, k) > 0)),
      category: count(found, (l) => [l.category]),
      source: count(found, (l) => [l.source.id]),
      installed: listings.filter((l) => l.installs.length > 0).length,
      updates: listings.filter(hasUpdate).length,
    },
    problems: [],
    ...(next ? { nextCursor: next } : {}),
  }
}

/**
 * An install extra the way the desktop app is offered, for listings with a screen (or the ones
 * named in `only`), recording what was made and removed.
 */
export function installExtra(
  opts: { has?: string[]; fails?: string; only?: string[]; made?: string[] } = {},
) {
  const made = opts.made ?? []
  const removed: string[] = []
  const extra: StoreInstallExtra = {
    id: 'desktop-app',
    label: 'Install as app',
    hint: 'Also adds it as an app with its own window',
    icon: MonitorDown,
    makes: 'desktop app',
    available: (l) =>
      opts.only
        ? opts.only.includes(l.ref.id)
        : l.contents !== 'unknown' && Boolean(l.contents.screen),
    has: (l) => (opts.has ?? []).includes(l.ref.id),
    make: async (l) => {
      made.push(l.ref.id)
      if (opts.fails) throw new Error(opts.fails)
    },
    remove: async (l) => void removed.push(l.ref.id),
  }
  return { extra, made, removed }
}

export interface StoreFake {
  listings: Listing[]
  problems?: StoreProblem[]
  sources?: SourceView[]
  previewFails?: string
  /** Kinds whose preview reads the address; the others refuse it. */
  understood?: string[]
  discover?: Partial<DiscoverResponse>
  /** What a recommendation answers, by listing id. */
  recommended?: string[]
  /** The background has not worked the recommendations out yet. */
  recommendPending?: boolean
  /** Each recommendation asked, as its references' labels and the chat: `Dockerfile in s1`. */
  recommendAsked?: string[]
  /** The settings of an install, by listing id and scope. */
  configs?: Record<string, Partial<Record<Scope, ListingConfig>>>
  /** The kinds that can make an item, with the form of each. */
  creates?: Partial<Record<PackageKind, CreateForm>>
  /** What a kind's provider can do to a shelf, by scope. */
  shelfActions?: Partial<Record<Scope, Array<ItemAction & { kind: PackageKind }>>>
  /** The preview of a shelf action, by `kind/action/scope`. */
  shelfPlans?: Record<string, ShelfPlan>
  /** The notice a listing's page shows, by listing id. */
  notices?: Record<string, NonNullable<ListingDetail['notice']>>
  /** Reads that fail while set, by what is read; `recover` on the view clears them. */
  failing?: { page?: boolean; discover?: boolean; detail?: boolean; plan?: boolean }
  /** A provider's refusal to create, in its words. */
  createFails?: string
  /** What running an install's action answers, by action id. */
  actionResults?: Record<string, ActionResult>
  /** A provider's refusal of every save, in its words. */
  configFails?: string
  /** A provider's refusal of every auto-update switch, in its words. */
  autoUpdateFails?: string
  calls: string[]
  /** Every page read, as its query: `shelf=package:mini-app cursor=40`. */
  reads?: string[]
}

export const SOURCES: SourceView[] = [
  { kind: 'mini-app', id: HOSTED, label: 'Localix', url: HOSTED, builtIn: true, count: 0 },
]
