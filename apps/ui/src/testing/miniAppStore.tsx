import type {
  MiniAppCatalogEntryRecord,
  MiniAppCatalogPreviewRecord,
  MiniAppStoreEntryRecord,
  MiniAppStorePageRecord,
} from '@localixai/api/client'

/**
 * Renders the mini app store as a person meets it, with every action it can take recorded. The
 * store portals menus and dialogs to the body, so queries look there too.
 */

export const HOSTED =
  'https://github.com/rsaryev/localix/releases/latest/download/mini-app-catalog.json'
export const ADA = 'https://ada.test/mini-app-catalog.json'

export const storeEntry = (
  over: Partial<MiniAppStoreEntryRecord> & { name: string },
): MiniAppStoreEntryRecord => ({
  description: `${over.name} does things`,
  publisher: { name: 'Localix', verified: true },
  source: HOSTED,
  installed: null,
  update: false,
  ...over,
})

export const storePage = (entry: MiniAppStoreEntryRecord): MiniAppStorePageRecord => ({
  entry,
  readme: `# ${entry.displayName ?? entry.name}\n\nPlay a **real** game.\n\n<b>raw</b>`,
  screenshots: [
    { url: `/rpc/mini-apps/store/media/${entry.name}/screenshot/0`, caption: 'The board' },
    { url: `/rpc/mini-apps/store/media/${entry.name}/screenshot/1`, caption: 'A finished game' },
  ],
  details: {
    version: entry.version ?? '1.0.0',
    apiVersion: 1,
    size: 182_340,
    license: 'MIT',
    author: 'Ada',
    homepage: 'https://example.test/chess',
    surfaces: ['agent', 'workbench'],
    commands: 2,
  },
})

export interface StoreCalls {
  install: { name: string; acceptUnverified: boolean }[]
  remove: string[]
  desktopInstall: string[]
  desktopRemove: string[]
  catalogAdd: string[]
  catalogRemove: string[]
  preview: string[]
}

export interface RenderOptions {
  entries: MiniAppStoreEntryRecord[]
  problems?: string[]
  catalogs?: MiniAppCatalogEntryRecord[]
  /** Which apps may also become desktop apps here; absent, none may. */
  desktopAvailable?: (entry: MiniAppStoreEntryRecord) => boolean
  desktopInstalled?: string[]
  desktopFails?: string
  previewFails?: string
  addCatalogUrl?: string
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

export async function renderStore(options: RenderOptions) {
  const calls: StoreCalls = {
    install: [],
    remove: [],
    desktopInstall: [],
    desktopRemove: [],
    catalogAdd: [],
    catalogRemove: [],
    preview: [],
  }
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MiniAppStoreView } = await import('@/entities/mini-app-store/ui/MiniAppStore')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props = (entries: MiniAppStoreEntryRecord[]) => (
    <MiniAppStoreView
      entries={entries}
      problems={options.problems ?? []}
      loading={false}
      onInstall={(name, opts) =>
        calls.install.push({ name, acceptUnverified: opts?.acceptUnverified ?? false })
      }
      onRemove={(name) => calls.remove.push(name)}
      loadPage={async (name) => storePage(entries.find((entry) => entry.name === name)!)}
      catalogs={{
        list: options.catalogs ?? [{ url: HOSTED, builtIn: true }],
        preview: async (url): Promise<MiniAppCatalogPreviewRecord> => {
          calls.preview.push(url)
          if (options.previewFails) throw new Error(options.previewFails)
          return { url, publishers: ['Ada'], apps: 3, icons: [], verified: false, added: false }
        },
        add: async (url) => void calls.catalogAdd.push(url),
        remove: async (url) => void calls.catalogRemove.push(url),
      }}
      desktop={
        options.desktopAvailable
          ? {
              available: options.desktopAvailable,
              has: (name) => (options.desktopInstalled ?? []).includes(name),
              install: async (name) => {
                calls.desktopInstall.push(name)
                if (options.desktopFails) throw new Error(options.desktopFails)
              },
              remove: async (name) => void calls.desktopRemove.push(name),
            }
          : undefined
      }
      addCatalogUrl={options.addCatalogUrl}
    />
  )
  await React.act(async () => {
    root.render(props(options.entries))
    await settle()
  })
  const act = async (run: () => unknown) =>
    React.act(async () => {
      await run()
      await settle()
    })
  const row = (name: string) => host.querySelector<HTMLElement>(`[data-mini-app="${name}"]`)
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
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'),
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
  const rerender = (entries: MiniAppStoreEntryRecord[]) => act(() => root.render(props(entries)))
  const done = async () => {
    await React.act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  }
  return {
    host,
    calls,
    row,
    button,
    click,
    openMenu,
    menuItems,
    menuItem,
    type,
    press,
    rerender,
    act,
    done,
  }
}
