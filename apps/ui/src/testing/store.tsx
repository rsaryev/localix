import {
  COMPONENT_KINDS,
  componentCount,
  hasUpdate,
  onShelf,
  parseShelf,
  shelfCounts,
  type ActionResult,
  type CreateForm,
  type DiscoverResponse,
  type Listing,
  type ListingConfig,
  type ListingsResponse,
  type PackageKind,
  type Scope,
  type SourceView,
} from '@localixai/store'
import { makeListing, makeListingDetail } from '@localixai/store/testing'
import { ApiError } from '@/shared/api/internal'
import type { StoreClient, StorePageQuery } from '@/shared/api/store-client'
import { MonitorDown } from 'lucide-react'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import type { StoreTarget } from '@/shared/lib/openStore'
import type { StoreProject } from '@/features/store/model/storeContext'
import { resourceSync } from '@/shared/api/resourceSync'
import { stubStoreLayout } from './storeLayout'

/**
 * Renders the Store as a person meets it, over a client that answers from memory, a page at a
 * time, and records every call. Menus and dialogs portal to the body, so queries look there too.
 */

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
      (!query.trust || (l.source.trust ?? 'community') === query.trust) &&
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
  problems?: string[]
  sources?: SourceView[]
  previewFails?: string
  /** Kinds whose preview reads the address; the others refuse it. */
  understood?: string[]
  discover?: Partial<DiscoverResponse>
  /** The settings of an install, by listing id and scope. */
  configs?: Record<string, Partial<Record<Scope, ListingConfig>>>
  /** The kinds that can make an item, with the form of each. */
  creates?: Partial<Record<PackageKind, CreateForm>>
  /** A provider's refusal to create, in its words. */
  createFails?: string
  /** What running an install's action answers, by action id. */
  actionResults?: Record<string, ActionResult>
  /** A provider's refusal of every save, in its words. */
  configFails?: string
  calls: string[]
  /** Every page read, as its query: `shelf=package:mini-app cursor=40`. */
  reads?: string[]
}

export const SOURCES: SourceView[] = [
  { kind: 'mini-app', id: HOSTED, label: 'Localix', url: HOSTED, builtIn: true, count: 0 },
]

/** A client over `fake`, recording each write as one line ("install mini-app/chess user …"). */
export function fakeClient(fake: StoreFake): StoreClient {
  const call = (line: string) => void fake.calls.push(line)
  const find = (id: string) => fake.listings.find((l) => l.ref.id === id)!
  const needsYes = (id: string) =>
    !find(id).publisher.verified || (find(id).source.trust ?? 'community') === 'community'
  const where = (projectId?: string | null) => (projectId ? ` in ${projectId}` : '')
  return {
    page: async (asked) => {
      const query = asked ?? {}
      fake.reads?.push(
        Object.entries(query)
          .map(([key, value]) => `${key}=${value}`)
          .join(' '),
      )
      return { ...answer(fake.listings, query), problems: fake.problems ?? [] }
    },
    detail: async (ref) =>
      makeListingDetail(find(ref.id), {
        facts: [
          { label: 'Version', value: find(ref.id).version ?? '1.0.0' },
          { label: 'License', value: 'MIT' },
          { label: 'Homepage', value: 'https://example.test/chess' },
        ],
        components: find(ref.id).components ?? [
          { kind: 'screen', name: find(ref.id).displayName, description: 'A screen of its own' },
          { kind: 'command', name: `/${ref.id}:play` },
        ],
      }),
    plan: async (ref, scope) => ({
      scope,
      adds: [],
      runs: [{ kind: 'hook', name: 'PreToolUse', command: 'node check.js' }],
      network: ['api.example.test'],
      requires: [],
      warnings: needsYes(ref.id) ? ['Localix does not review what this source lists'] : [],
      needsConsent: needsYes(ref.id),
    }),
    install: async (ref, scope, consent, projectId) => {
      if (needsYes(ref.id) && !consent.plan)
        throw new ApiError('Read what it runs, then say yes', 409, 'consent')
      call(
        `install ${ref.kind}/${ref.id} ${scope}${consent.plan ? ' consent' : ''}${where(projectId)}`,
      )
    },
    update: async (ref, scope) => call(`update ${ref.kind}/${ref.id} ${scope}`),
    remove: async (ref, scope) => call(`remove ${ref.kind}/${ref.id} ${scope}`),
    setEnabled: async (ref, scope, enabled) =>
      call(`${enabled ? 'enable' : 'disable'} ${ref.kind}/${ref.id} ${scope}`),
    config: async (ref, scope) => {
      const config = fake.configs?.[ref.id]?.[scope]
      if (!config) throw new ApiError('No settings', 404, 'store_config_not_found')
      return config
    },
    setConfig: async (ref, scope, values, projectId) => {
      if (fake.configFails) throw new ApiError(fake.configFails, 400, 'plugin_config_invalid')
      call(`config ${ref.kind}/${ref.id} ${scope}${where(projectId)} ${JSON.stringify(values)}`)
    },
    runAction: async (ref, scope, action) => {
      call(`action ${ref.kind}/${ref.id} ${scope} ${action}`)
      return fake.actionResults?.[action] ?? { ok: true }
    },
    creatable: async () => Object.keys(fake.creates ?? {}) as PackageKind[],
    createFields: async (kind) => fake.creates![kind]!,
    create: async (kind, scope, values, projectId) => {
      if (fake.createFails) throw new ApiError(fake.createFails, 409, 'store_exists')
      call(`create ${kind} ${scope}${where(projectId)} ${JSON.stringify(values)}`)
      return { kind, id: (values.name as string | undefined) ?? 'new' }
    },
    sources: async () => ({ sources: fake.sources ?? SOURCES, addable: ['mini-app', 'plugin'] }),
    discover: async () => ({
      hero: null,
      updates: { count: fake.listings.filter(hasUpdate).length },
      rows: [],
      categories: [],
      listings: fake.listings,
      ...fake.discover,
    }),
    previewSource: async (kind, input) => {
      call(`preview ${kind} ${input}`)
      if (fake.previewFails) throw new Error(fake.previewFails)
      if (fake.understood && !fake.understood.includes(kind))
        throw new Error(`Not a ${kind} source`)
      return {
        kind,
        id: input,
        label: input,
        publishers: ['Ada'],
        count: 3,
        icons: [],
        verified: false,
        added: false,
      }
    },
    addSource: async (kind, input) => call(`add source ${kind} ${input}`),
    removeSource: async (kind, id) => call(`remove source ${kind} ${id}`),
    refreshSource: async (kind, id) => call(`refresh source ${kind} ${id}`),
    setSourceAutoUpdate: async (kind, id, on) => call(`auto-update ${kind} ${id} ${on}`),
    activity: async () => ({ jobs: [], updates: [] }),
    applyUpdates: async () => {
      call('update all')
      return []
    },
  }
}

export interface RenderStoreOptions extends Omit<StoreFake, 'calls'> {
  target?: StoreTarget
  extras?: StoreInstallExtra[]
  project?: StoreProject | null
  /** The Store pane's width in px: 1400 (wide) unless a test asks for another. */
  width?: number
}

/** Let reads answer: event-loop turns, never a timer. */
const turns = (act: (run: () => Promise<void>) => Promise<void>, n = 12) =>
  act(async () => {
    for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setImmediate(resolve))
  })

export async function renderStore(options: RenderStoreOptions) {
  const { target, extras, project, width = 1400, ...rest } = options
  const fake: StoreFake = { calls: [], reads: [], ...rest }
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig, useSWRConfig } = await import('swr')
  const { StoreView } = await import('@/features/store/ui/StoreView')
  const restoreLayout = stubStoreLayout(width)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let revalidate: () => Promise<unknown> = async () => {}
  function Probe() {
    const { mutate } = useSWRConfig()
    revalidate = () => mutate(() => true)
    return null
  }
  const client = fakeClient(fake)
  const tree = (at?: StoreTarget) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Probe />
      <StoreView
        client={client}
        target={at}
        extras={extras ?? []}
        project={project ?? null}
        searchDelay={0}
        onNavigate={(uri) => fake.calls.push(`navigate ${uri}`)}
      />
    </SWRConfig>
  )
  await React.act(async () => root.render(tree(target)))
  await turns(React.act)
  const act = async (run: () => unknown) => {
    await React.act(async () => {
      await run()
    })
    await turns(React.act)
  }
  const card = (id: string) => host.querySelector<HTMLElement>(`[data-listing="${id}"]`)
  const buttons = (scope: ParentNode = document.body) => [
    ...scope.querySelectorAll<HTMLButtonElement>('button'),
  ]
  /** A button by its accessible name: its aria-label, or its text when it has none. */
  const button = (name: string, scope: ParentNode = document.body) =>
    buttons(scope).find(
      (candidate) =>
        candidate.getAttribute('aria-label') === name ||
        (!candidate.hasAttribute('aria-label') && candidate.textContent?.trim() === name),
    )
  const click = (element: Element | null | undefined) => {
    if (!element) throw new Error('nothing to click')
    return act(() => (element as HTMLElement).click())
  }
  /** Open a menu trigger the way a keyboard does. */
  const openMenu = (trigger: HTMLElement | undefined) => {
    if (!trigger) throw new Error('no menu trigger')
    return act(() => {
      trigger.focus()
      trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }
  const menuItems = () => [
    ...document.body.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
    ),
  ]
  const menuItem = (label: string) =>
    menuItems().find((item) => item.querySelector('.truncate')?.textContent === label)
  const type = (input: HTMLInputElement | null, value: string) =>
    act(() => {
      if (!input) throw new Error('no field')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const press = (key: string, at: Element | null = document.activeElement) =>
    act(() => {
      at?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
  /** The server's listings changed and it poked the Store. */
  const change = (listings: Listing[]) =>
    act(async () => {
      fake.listings = listings
      resourceSync.invalidate(['store'])
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
      await revalidate()
    })
  /** The tab was opened again at another target. */
  const retarget = (at: StoreTarget) => act(() => root.render(tree(at)))
  const shelf = (label: string) =>
    buttons(host.querySelector('nav[aria-label="Store sections"]') ?? host).find((b) =>
      b.textContent?.startsWith(label),
    )
  const done = async () => {
    await React.act(async () => root.unmount())
    restoreLayout()
    host.remove()
    document.body.innerHTML = ''
  }
  return {
    host,
    calls: fake.calls,
    reads: fake.reads!,
    card,
    button,
    click,
    openMenu,
    menuItems,
    menuItem,
    type,
    press,
    change,
    retarget,
    shelf,
    act,
    done,
  }
}
