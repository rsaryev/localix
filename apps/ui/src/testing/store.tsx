import type { Listing, SourceView } from '@localixai/store'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import type { StoreTarget } from '@/shared/lib/openStore'
import type { StoreProject } from '@/features/store/model/storeContext'
import { resourceSync } from '@/shared/api/resourceSync'
import { stubStoreLayout } from './storeLayout'
import { fakeClient } from './storeFake'
import type { StoreFake } from './storeFixtures'

export {
  HOSTED,
  ADA,
  SOURCES,
  listing,
  answer,
  installExtra,
  type StoreFake,
} from './storeFixtures'
export { fakeClient } from './storeFake'

/**
 * Renders the Store as a person meets it, over a client that answers from memory, a page at a
 * time, and records every call. Menus and dialogs portal to the body, so queries look there too.
 */

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
  const button = (name: string | RegExp, scope: ParentNode = document.body) => {
    const is = (text: string | null | undefined) =>
      text != null && (typeof name === 'string' ? text === name : name.test(text))
    return buttons(scope).find(
      (candidate) =>
        is(candidate.getAttribute('aria-label')) ||
        (!candidate.hasAttribute('aria-label') && is(candidate.textContent?.trim())),
    )
  }
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
  /** The server's sources changed and it poked the Store's sources. */
  const changeSources = (sources: SourceView[]) =>
    act(async () => {
      fake.sources = sources
      resourceSync.invalidate(['store-sources'])
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
    changeSources,
    retarget,
    /** The failing reads answer again, and the Store is poked to read. */
    recover: () => {
      fake.failing = {}
    },
    shelf,
    act,
    done,
  }
}
