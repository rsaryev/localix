import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const ICON = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'

describe('AppTile', () => {
  test('a picture when there is one, the monogram when it is missing or will not load', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { AppTile } = await import('./app-tile')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await React.act(async () =>
      root.render(<AppTile identity="convex@official" label="Convex" size={64} />),
    )
    const tile = host.querySelector<HTMLElement>('[data-slot="app-tile"]')!
    expect(tile.getAttribute('aria-hidden')).toBe('true')
    expect(tile.textContent).toBe('CO')
    expect(tile.style.width).toBe('64px')
    const hue = (tile.firstElementChild as HTMLElement).style.getPropertyValue('--avatar-hue')
    // The same identity is the same colour wherever it is drawn.
    await React.act(async () =>
      root.render(<AppTile identity="convex@official" label="Convex DB" size={32} />),
    )
    const again = host.querySelector<HTMLElement>('[data-slot="app-tile"]')!
    expect((again.firstElementChild as HTMLElement).style.getPropertyValue('--avatar-hue')).toBe(
      hue,
    )
    expect(again.textContent).toBe('CD')

    await React.act(async () =>
      root.render(<AppTile identity="atlas" label="Atlas" src={ICON} size={64} />),
    )
    const img = host.querySelector('img')!
    expect(img.getAttribute('src')).toBe(ICON)
    await React.act(async () => void img.dispatchEvent(new Event('error')))
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toBe('AT')
    await React.act(async () => root.unmount())
    host.remove()
  })
})
