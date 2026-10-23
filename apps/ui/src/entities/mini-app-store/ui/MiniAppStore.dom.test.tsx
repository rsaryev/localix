import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const entry = (
  over: Partial<MiniAppStoreEntryRecord> & { name: string },
): MiniAppStoreEntryRecord => ({
  description: `${over.name} does things`,
  publisher: { name: 'Localix', verified: true },
  installed: null,
  update: false,
  ...over,
})

const ENTRIES = [
  entry({ name: 'chess', displayName: 'Chess', category: 'games', version: '1.0.0' }),
  entry({
    name: 'kanban',
    displayName: 'Kanban',
    category: 'utilities',
    installed: { version: '1.0.0' },
  }),
  entry({
    name: 'trading',
    displayName: 'Trading',
    category: 'data',
    version: '2.0.0',
    installed: { version: '1.0.0' },
    update: true,
  }),
  entry({
    name: 'weather',
    displayName: 'Weather',
    category: 'utilities',
    job: { phase: 'downloading', received: 25, total: 100 },
  }),
  entry({
    name: 'radio',
    displayName: 'Radio',
    category: 'content',
    publisher: { name: 'Someone', verified: false },
  }),
  entry({ name: 'future', displayName: 'Future', incompatible: true }),
]

interface Calls {
  install: { name: string; acceptUnverified: boolean }[]
  remove: string[]
}

async function render(problems: string[] = []) {
  const calls: Calls = { install: [], remove: [] }
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MiniAppStoreView } = await import('./MiniAppStore')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MiniAppStoreView
        entries={ENTRIES}
        problems={problems}
        loading={false}
        onInstall={(name, opts) =>
          calls.install.push({ name, acceptUnverified: opts?.acceptUnverified ?? false })
        }
        onRemove={(name) => calls.remove.push(name)}
      />,
    ),
  )
  const row = (name: string) => host.querySelector<HTMLElement>(`[data-mini-app="${name}"]`)
  const button = (name: string, label: string) =>
    [...(row(name)?.querySelectorAll('button') ?? [])].find(
      (candidate) =>
        candidate.getAttribute('aria-label') === label ||
        (!candidate.hasAttribute('aria-label') && candidate.textContent === label),
    )
  const section = (name: string) =>
    row(name)?.closest('section')?.querySelector('h2')?.textContent ?? null
  const click = async (element: Element | null | undefined) =>
    act(async () => (element as HTMLElement).click())
  const done = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { host, row, button, section, click, act, calls, done }
}

describe('the mini app store', () => {
  test('apps are grouped by what they need: an update, nothing, or installing', async () => {
    const view = await render()
    try {
      expect(view.section('trading')).toContain('Updates')
      expect(view.section('kanban')).toContain('Installed')
      expect(view.section('chess')).toContain('Available')
      expect(view.row('trading')?.textContent).toContain('1.0.0 → 2.0.0')
      expect(view.row('weather')?.querySelector('[role="progressbar"]')).not.toBeNull()
      expect(view.row('weather')?.textContent).toContain('25%')
      expect(view.row('future')?.textContent).toContain('Needs a newer Localix')
      expect(view.button('future', 'Install')).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('install, update and remove each call their action', async () => {
    const view = await render()
    try {
      await view.click(view.button('chess', 'Install'))
      await view.click(view.button('trading', 'Update'))
      await view.click(view.button('kanban', 'Remove Kanban'))
      expect(view.calls.install.map(({ name }) => name)).toEqual(['chess', 'trading'])
      expect(view.calls.remove).toEqual(['kanban'])
    } finally {
      await view.done()
    }
  })

  test('an unverified publisher is named, and installing asks for a yes in the row', async () => {
    const view = await render()
    try {
      expect(view.row('radio')?.textContent).toContain('Unverified')
      expect(view.row('radio')?.textContent).toContain('Someone')
      expect(view.row('chess')?.querySelector('[aria-label="Verified publisher"]')).not.toBeNull()

      await view.click(view.button('radio', 'Install'))
      expect(view.calls.install).toEqual([])
      expect(view.row('radio')?.textContent).toContain('Install anyway?')
      await view.click(view.button('radio', 'Install anyway'))
      expect(view.calls.install).toEqual([{ name: 'radio', acceptUnverified: true }])
    } finally {
      await view.done()
    }
  })

  test('a category narrows the rows, and the search finds by name or words', async () => {
    const view = await render()
    try {
      const tab = (label: string) =>
        [...view.host.querySelectorAll('[role="tab"]')].find((node) => node.textContent === label)
      await view.click(tab('Games'))
      expect(view.row('chess')).not.toBeNull()
      expect(view.row('kanban')).toBeNull()

      await view.click(tab('All'))
      const search = view.host.querySelector<HTMLInputElement>('input')!
      await view.act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(search, 'trad')
        search.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(view.row('trading')).not.toBeNull()
      expect(view.row('chess')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a catalog that could not be read is said once, above the apps', async () => {
    const view = await render(['The mini app catalog at example.test answered 503'])
    try {
      expect(view.host.textContent).toContain('answered 503')
    } finally {
      await view.done()
    }
  })
})
