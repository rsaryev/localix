import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const HOSTED = 'https://github.com/rsaryev/localix/releases/latest/download/mini-app-catalog.json'
const THEIRS = 'https://ada.test/releases/latest/download/mini-app-catalog.json'

async function render(onAdd: (url: string) => Promise<void>) {
  const removed: string[] = []
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MiniAppCatalogsView } = await import('./MiniAppCatalogs')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MiniAppCatalogsView
        catalogs={[
          { url: HOSTED, builtIn: true },
          { url: THEIRS, builtIn: false },
        ]}
        onAdd={onAdd}
        onRemove={async (url) => void removed.push(url)}
      />,
    ),
  )
  const type = async (value: string) =>
    act(async () => {
      const input = host.querySelector<HTMLInputElement>('input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const submit = async () =>
    act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  const done = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { host, act, type, submit, removed, done }
}

describe('the catalogs the store reads', () => {
  test('the Localix catalog is named and stays; an added one can be removed', async () => {
    const view = await render(async () => {})
    try {
      const rows = [...view.host.querySelectorAll('li')]
      expect(rows[0]?.textContent).toContain('Localix')
      expect(rows[0]?.querySelector('button')).toBeNull()
      expect(rows[1]?.textContent).toContain('ada.test')
      await view.act(async () =>
        rows[1]!.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]')!.click(),
      )
      expect(view.removed).toEqual([THEIRS])
    } finally {
      await view.done()
    }
  })

  test('adding one sends the address; a refusal is said under the field and the text stays', async () => {
    const sent: string[] = []
    const view = await render(async (url) => {
      sent.push(url)
      if (url.includes('broken'))
        throw new Error('The mini app catalog at broken.test answered 404')
    })
    try {
      await view.type('https://broken.test/catalog.json')
      await view.submit()
      expect(view.host.textContent).toContain('answered 404')
      expect(view.host.querySelector('input')!.value).toBe('https://broken.test/catalog.json')

      await view.type('https://bob.test/catalog.json')
      await view.submit()
      expect(sent).toEqual(['https://broken.test/catalog.json', 'https://bob.test/catalog.json'])
      expect(view.host.querySelector('input')!.value).toBe('')
      expect(view.host.textContent).not.toContain('answered 404')
    } finally {
      await view.done()
    }
  })
})
