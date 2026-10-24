import {
  COMPONENT_KINDS,
  componentCount,
  hasUpdate,
  onShelf,
  parseShelf,
  shelfCounts,
  type Listing,
  type ListingsResponse,
  type SourceView,
} from '@localixai/store'
import { makeListing, makeListingDetail } from '@localixai/store/testing'
import type { StoreClient } from '@/shared/api/store-client'
import type { StoreAppExtra } from '@/shared/lib/storeAppExtra'
import type { StoreTarget } from '@/shared/lib/openStore'

/**
 * Renders the Store as a person meets it, over a client that answers from memory and records
 * every call. Menus and dialogs portal to the body, so queries look there too.
 */

export const HOSTED = 'https://hosted.test/mini-app-catalog.json'
export const ADA = 'https://ada.test/mini-app-catalog.json'

export const listing = (over: Partial<Listing> & { id: string }): Listing =>
  makeListing({ source: { id: HOSTED, label: 'Localix' }, ...over })

const count = (listings: Listing[], keys: (l: Listing) => (string | undefined)[]) => {
  const counts: Record<string, number> = {}
  for (const l of listings) for (const key of keys(l)) if (key) counts[key] = (counts[key] ?? 0) + 1
  return counts
}

/** The server's answer for a query, the way the Store's index gives it. */
export function answer(
  listings: Listing[],
  query: { shelf?: string; q?: string },
): ListingsResponse {
  const shelf = parseShelf(query.shelf)
  const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const text = (l: Listing) =>
    [l.name, l.displayName, l.summary, ...l.tags, ...(l.componentNames ?? [])]
      .join(' ')
      .toLowerCase()
  return {
    listings: listings.filter(
      (l) => (!shelf || onShelf(l, shelf)) && words.every((word) => text(l).includes(word)),
    ),
    facets: {
      shelves: shelfCounts(listings),
      kind: count(listings, (l) => [l.ref.kind]),
      component: count(listings, (l) => COMPONENT_KINDS.filter((k) => componentCount(l, k) > 0)),
      category: count(listings, (l) => [l.category]),
      source: count(listings, (l) => [l.source.id]),
      installed: listings.filter((l) => l.installs.length > 0).length,
      updates: listings.filter(hasUpdate).length,
    },
    problems: [],
  }
}

export interface StoreFake {
  listings: Listing[]
  problems?: string[]
  sources?: SourceView[]
  previewFails?: string
  calls: string[]
}

export const SOURCES: SourceView[] = [
  { kind: 'mini-app', id: HOSTED, label: 'Localix', url: HOSTED, builtIn: true, count: 0 },
]

/** A client over `fake`, recording each write as one line ("install mini-app/chess user …"). */
export function fakeClient(fake: StoreFake): StoreClient {
  const call = (line: string) => void fake.calls.push(line)
  const find = (id: string) => fake.listings.find((l) => l.ref.id === id)!
  return {
    listings: async (query = {}) => ({
      ...answer(fake.listings, query),
      problems: fake.problems ?? [],
    }),
    detail: async (ref) =>
      makeListingDetail(find(ref.id), {
        facts: [
          { label: 'Version', value: find(ref.id).version ?? '1.0.0' },
          { label: 'License', value: 'MIT' },
          { label: 'Homepage', value: 'https://example.test/chess' },
        ],
        components: [
          { kind: 'screen', name: find(ref.id).displayName, description: 'A screen of its own' },
          { kind: 'command', name: `/${ref.id}:play` },
        ],
      }),
    plan: async (ref, scope) => ({
      scope,
      adds: [],
      runs: [{ kind: 'backend', name: find(ref.id).displayName }],
      network: [],
      requires: [],
      warnings: find(ref.id).publisher.verified
        ? []
        : ['Someone is not a publisher Localix verifies'],
      needsConsent: !find(ref.id).publisher.verified,
    }),
    install: async (ref, scope, consent) =>
      call(`install ${ref.kind}/${ref.id} ${scope}${consent.plan ? ' consent' : ''}`),
    update: async (ref, scope) => call(`update ${ref.kind}/${ref.id} ${scope}`),
    remove: async (ref, scope) => call(`remove ${ref.kind}/${ref.id} ${scope}`),
    setEnabled: async (ref, scope, enabled) =>
      call(`${enabled ? 'enable' : 'disable'} ${ref.kind}/${ref.id} ${scope}`),
    sources: async () => fake.sources ?? SOURCES,
    previewSource: async (kind, input) => {
      call(`preview ${kind} ${input}`)
      if (fake.previewFails) throw new Error(fake.previewFails)
      return {
        kind,
        id: input,
        label: new URL(input).host,
        publishers: ['Ada'],
        count: 3,
        icons: [],
        verified: false,
        added: false,
      }
    },
    addSource: async (kind, input) => call(`add source ${kind} ${input}`),
    removeSource: async (kind, id) => call(`remove source ${kind} ${id}`),
    activity: async () => ({ jobs: [], updates: [] }),
    applyUpdates: async () => {
      call('update all')
      return []
    },
  }
}

export interface RenderStoreOptions {
  listings: Listing[]
  problems?: string[]
  sources?: SourceView[]
  previewFails?: string
  target?: StoreTarget
  extra?: StoreAppExtra
}

/** Let reads answer: event-loop turns, never a timer. */
const turns = (act: (run: () => Promise<void>) => Promise<void>, n = 12) =>
  act(async () => {
    for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setImmediate(resolve))
  })

export async function renderStore(options: RenderStoreOptions) {
  const fake: StoreFake = { calls: [], ...options }
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig, useSWRConfig } = await import('swr')
  const { StoreView } = await import('@/features/store/ui/StoreView')
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
  const tree = (target?: StoreTarget) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Probe />
      <StoreView
        client={client}
        target={target}
        extra={options.extra}
        onConfigure={(uri) => fake.calls.push(`configure ${uri}`)}
      />
    </SWRConfig>
  )
  await React.act(async () => root.render(tree(options.target)))
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
  const press = (key: string, target: Element | null = document.activeElement) =>
    act(() => {
      target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
  /** The server's listings changed and it poked the Store. */
  const change = (listings: Listing[]) =>
    act(async () => {
      fake.listings = listings
      await revalidate()
    })
  /** The tab was opened again at another target. */
  const retarget = (target: StoreTarget) => act(() => root.render(tree(target)))
  const shelf = (label: string) =>
    buttons(host.querySelector('nav[aria-label="Store sections"]') ?? host).find((b) =>
      b.textContent?.startsWith(label),
    )
  const done = async () => {
    await React.act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  }
  return {
    host,
    calls: fake.calls,
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
