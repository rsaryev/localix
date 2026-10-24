import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UpdateOffer } from '@/shared/lib/background-activity/activityItems'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(() => window.localStorage.clear())

const calls: string[] = []
const store: UpdateOffer = {
  id: 'store',
  title: '3 updates',
  detail: 'Chess, Reader and Review',
  fingerprint:
    'mini-app:sample-chess@1.1.0,mini-app:sample-reader@0.4.0,plugin:review@localix@1.1.0',
  action: { id: 'update-all', label: 'Update all', run: () => calls.push('store') },
}
const app: UpdateOffer = {
  id: 'app',
  title: 'Localix 1.5.0',
  detail: 'you have 1.4.0',
  fingerprint: '1.5.0',
}

async function mount(offers: UpdateOffer[]) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { UpdateOffersRow } = await import('./UpdateOffersRow')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (next: UpdateOffer[]) =>
    React.act(async () => root.render(<UpdateOffersRow offers={next} />))
  await render(offers)
  return {
    host,
    render,
    act: React.act,
    button: (name: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
      ),
    unmount: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('the composer’s update strip', () => {
  test('offers the Store’s updates, every kind together, with Update all', async () => {
    calls.length = 0
    const view = await mount([app, store])
    expect(view.host.textContent).toContain('3 updates')
    expect(view.host.textContent).toContain('Chess, Reader and Review')
    expect(view.host.textContent).not.toContain('Localix 1.5.0')
    view.button('Update all')?.click()
    expect(calls).toEqual(['store'])
    await view.unmount()
  })

  test('a hidden offer stays hidden until what it offers changes', async () => {
    const view = await mount([store])
    await view.act(async () => view.button('Hide until there are newer updates')?.click())
    expect(view.host.textContent).toBe('')
    expect(window.localStorage.getItem('localix.update.dismissed.store')).toBe(store.fingerprint)
    await view.render([{ ...store, title: '4 updates', fingerprint: 'more' }])
    expect(view.host.textContent).toContain('4 updates')
    await view.unmount()
  })

  test('while an update runs it shows how far it is, with nothing to press', async () => {
    const view = await mount([
      { ...store, action: undefined, running: { percent: 40, status: 'Updating Chess · 40%' } },
    ])
    expect(view.host.textContent).toContain('Updating Chess · 40%')
    expect(view.button('Update all')).toBeUndefined()
    expect(view.host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '40',
    )
    await view.unmount()
  })
})
