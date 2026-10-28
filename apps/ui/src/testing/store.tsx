import type { Listing, SourceView } from '@localixai/store'
import { tap } from './hookProbe'
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
  /** The chat open beside the Store. */
  sessionId?: string
  /** The Store pane's width in px: 1400 (wide) unless a test asks for another. */
  width?: number
}

/** Let reads answer: event-loop turns, never a timer. */
const turns = (act: (run: () => Promise<void>) => Promise<void>, n = 12) =>
  act(async () => {
    for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setImmediate(resolve))
  })

/** Zero-delay timer turns: the resource sync schedules its reads with `setTimeout(..., 0)`. */
async function timerTurns(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export async function renderStore(options: RenderStoreOptions) {
  const { target, extras, project, sessionId, width = 1400, ...rest } = options
  const fake: StoreFake = { calls: [], reads: [], ...rest }
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig, useSWRConfig } = await import('swr')
  const { StoreView } = await import('@/features/store/ui/StoreView')
  const restoreLayout = stubStoreLayout(width)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const revalidator = tap<() => Promise<unknown>>()
  const revalidate = () => revalidator.value?.() ?? Promise.resolve()
  function Probe() {
    const { mutate } = useSWRConfig()
    revalidator.put(() => mutate(() => true))
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
        sessionId={sessionId ?? null}
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
      await timerTurns()
      await revalidate()
    })
  /** The server's sources changed and it poked the Store's sources. */
  const changeSources = (sources: SourceView[]) =>
    act(async () => {
      fake.sources = sources
      resourceSync.invalidate(['store-sources'])
      await timerTurns()
      await revalidate()
    })
  /** The background worked the recommendations out and poked their topic; nothing else is read. */
  const recommendationsReady = () =>
    act(async () => {
      fake.recommendPending = false
      resourceSync.invalidate(['store-recommendations'])
      await timerTurns()
    })
  /** The tab was opened again at another target. */
  const retarget = (at: StoreTarget) => act(() => root.render(tree(at)))
  const sections = () =>
    host.querySelector<HTMLElement>('[role="tablist"][aria-label="Store sections"]')
  const library = () => host.querySelector<HTMLElement>('[aria-label="Your library"]')
  /** A section's control by its text: a catalog tab, or a button of the library. */
  const shelf = (label: string) =>
    [
      ...(sections()?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
      ...(library()?.querySelectorAll<HTMLElement>('button') ?? []),
    ].find((control) => control.textContent?.startsWith(label))
  /** The section on screen, by the text of the control that marks it. */
  const activeSection = () =>
    (
      sections()?.querySelector('[role="tab"][aria-selected="true"]') ??
      host.querySelector('[data-store-nav] [aria-current="page"]')
    )?.textContent ?? undefined
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
    recommendationsReady,
    retarget,
    /** The failing reads answer again, and the Store is poked to read. */
    recover: () => {
      fake.failing = {}
    },
    shelf,
    activeSection,
    act,
    done,
  }
}
