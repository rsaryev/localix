import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ADA, HOSTED } from '@/testing/miniAppStore'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function render() {
  const removed: string[] = []
  const added: string[] = []
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MiniAppCatalogsView } = await import('./MiniAppCatalogs')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MiniAppCatalogsView
        catalogs={{
          list: [
            { url: HOSTED, builtIn: true },
            { url: ADA, builtIn: false },
          ],
          preview: async (url) => ({
            url,
            publishers: ['Bob'],
            apps: 1,
            icons: [],
            verified: false,
            added: false,
          }),
          add: async (url) => void added.push(url),
          remove: async (url) => void removed.push(url),
        }}
        counts={{ [HOSTED]: 19, [ADA]: 2 }}
      />,
    ),
  )
  const click = async (element: Element | null | undefined) =>
    act(async () => {
      ;(element as HTMLElement).click()
      await settle()
    })
  const done = async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  }
  return { host, act, click, removed, added, done }
}

describe('Settings → Mini apps → Catalogs', () => {
  test('lists Localix first with its app count, then the added ones, each removable', async () => {
    const view = await render()
    try {
      const rows = [...view.host.querySelectorAll('li')]
      expect(rows[0]?.textContent).toContain('Localix')
      expect(rows[0]?.textContent).toContain('19 apps')
      expect(rows[0]?.querySelector('button')).toBeNull()
      expect(rows[1]?.textContent).toContain('ada.test')
      await view.click(rows[1]!.querySelector('button[aria-label="Remove ada.test"]'))
      expect(view.removed).toEqual([ADA])
    } finally {
      await view.done()
    }
  })

  test('Add catalog… opens the same dialog the store uses', async () => {
    const view = await render()
    try {
      const add = [...view.host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Add catalog…',
      )
      await view.click(add)
      expect(document.body.querySelector('[role="dialog"] h2')?.textContent).toBe('Add a catalog')
    } finally {
      await view.done()
    }
  })
})
