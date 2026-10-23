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
    publisher: { name: 'Someone', verified: false },
    job: { phase: 'installing' },
  }),
]

async function render(onInstall: (name: string) => void) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MiniAppStoreView } = await import('./MiniAppStore')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(<MiniAppStoreView entries={ENTRIES} loading={false} onInstall={onInstall} />),
  )
  const card = (name: string) => host.querySelector<HTMLElement>(`[data-mini-app="${name}"]`)
  const click = async (element: Element | null | undefined) =>
    act(async () => (element as HTMLElement).click())
  const done = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { host, card, click, act, done }
}

describe('the mini app store', () => {
  test('each app is a card with its publisher, and the one action its state allows', async () => {
    const installed: string[] = []
    const view = await render((name) => installed.push(name))
    try {
      expect(view.card('chess')?.textContent).toContain('Chess')
      expect(view.card('chess')?.textContent).toContain('Localix')
      expect(view.card('chess')?.querySelector('[aria-label="Verified publisher"]')).not.toBeNull()
      expect(view.card('weather')?.textContent).toContain('Unverified')

      await view.click(
        [...(view.card('chess')?.querySelectorAll('button') ?? [])].find(
          (button) => button.textContent === 'Install',
        ),
      )
      expect(installed).toEqual(['chess'])

      expect(view.card('kanban')?.textContent).toContain('Installed')
      const update = [...(view.card('trading')?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent === 'Update',
      )
      await view.click(update)
      expect(installed).toEqual(['chess', 'trading'])

      const weather = view.card('weather')
      expect(weather?.textContent).toContain('Installing')
      expect(weather?.querySelector('[role="progressbar"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a category narrows the cards, and the search finds by name or words', async () => {
    const view = await render(() => {})
    try {
      const pill = (label: string) =>
        [...view.host.querySelectorAll('button')].find((button) => button.textContent === label)
      await view.click(pill('Games'))
      expect(view.card('chess')).not.toBeNull()
      expect(view.card('kanban')).toBeNull()

      await view.click(pill('All'))
      const search = view.host.querySelector<HTMLInputElement>('input')!
      await view.act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(search, 'trad')
        search.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(view.card('trading')).not.toBeNull()
      expect(view.card('chess')).toBeNull()
    } finally {
      await view.done()
    }
  })
})
