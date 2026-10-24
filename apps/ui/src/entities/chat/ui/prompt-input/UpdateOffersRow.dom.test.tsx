import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UpdateOffer } from '@/shared/lib/background-activity/activityItems'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(() => {
  jest.useRealTimers()
  window.localStorage.clear()
})

const calls: string[] = []
const miniApps: UpdateOffer = {
  id: 'mini-apps',
  title: '2 mini app updates',
  detail: 'Chess and Reader',
  fingerprint: 'chess@1.1.0,reader@0.4.0',
  action: { id: 'update-all', label: 'Update all', run: () => calls.push('mini apps') },
}
const plugins: UpdateOffer = {
  id: 'plugins',
  title: '3 plugin updates',
  detail: 'review, lint and docs',
  fingerprint: 'p1',
  action: { id: 'update-all', label: 'Update all', run: () => calls.push('plugins') },
}

async function mount(offers: UpdateOffer[], opts: { reducedMotion?: boolean } = {}) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { UpdateOffersRow } = await import('./UpdateOffersRow')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (next: UpdateOffer[]) =>
    React.act(async () =>
      root.render(
        <UpdateOffersRow
          offers={next}
          rotateMs={8_000}
          reducedMotion={opts.reducedMotion ?? false}
        />,
      ),
    )
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
  test('shows one offer at a time, with Update all', async () => {
    calls.length = 0
    const view = await mount([miniApps, plugins])
    expect(view.host.textContent).toContain('2 mini app updates')
    expect(view.host.textContent).not.toContain('3 plugin updates')
    view.button('Update all')?.click()
    expect(calls).toEqual(['mini apps'])
    await view.unmount()
  })

  test('turns to the next offer every few seconds, but not while the pointer rests on it', async () => {
    jest.useFakeTimers()
    const view = await mount([miniApps, plugins])
    await view.act(async () => void jest.advanceTimersByTime(8_000))
    expect(view.host.textContent).toContain('3 plugin updates')

    const strip = view.host.querySelector<HTMLElement>('[data-slot="workbench-notice-bar"]')!
    await view.act(async () => {
      strip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    await view.act(async () => void jest.advanceTimersByTime(16_000))
    expect(view.host.textContent).toContain('3 plugin updates')
    await view.unmount()
  })

  test('with reduced motion it stays put; Next shows the other offer', async () => {
    jest.useFakeTimers()
    const view = await mount([miniApps, plugins], { reducedMotion: true })
    await view.act(async () => void jest.advanceTimersByTime(24_000))
    expect(view.host.textContent).toContain('2 mini app updates')
    await view.act(async () => view.button('Show the next update')?.click())
    expect(view.host.textContent).toContain('3 plugin updates')
    await view.unmount()
  })

  test('a hidden offer stays hidden until what it offers changes', async () => {
    const view = await mount([miniApps])
    await view.act(async () => view.button('Hide until there are newer updates')?.click())
    expect(view.host.textContent).toBe('')
    expect(window.localStorage.getItem('localix.update.dismissed.mini-apps')).toBe(
      'chess@1.1.0,reader@0.4.0',
    )
    await view.render([{ ...miniApps, title: '3 mini app updates', fingerprint: 'more' }])
    expect(view.host.textContent).toContain('3 mini app updates')
    await view.unmount()
  })

  test('while an update runs it shows how far it is, with nothing to press', async () => {
    const view = await mount([
      { ...miniApps, action: undefined, running: { percent: 40, status: 'Updating Chess · 40%' } },
    ])
    expect(view.host.textContent).toContain('Updating Chess · 40%')
    expect(view.button('Update all')).toBeUndefined()
    expect(view.host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '40',
    )
    await view.unmount()
  })
})
