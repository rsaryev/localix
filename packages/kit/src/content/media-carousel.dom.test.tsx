import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const ITEMS = [
  { src: '/shots/0.png', caption: 'The board' },
  { src: '/shots/1.png', caption: 'A finished game' },
]

describe('MediaCarousel', () => {
  test('pages with arrows, the keyboard and dots, announcing each caption; a picture opens', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { MediaCarousel } = await import('./media-carousel')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const opened: number[] = []
    const act = (run: () => void) => React.act(async () => run())
    const button = (name: string) =>
      host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
    const shown = () =>
      host.querySelector('[aria-roledescription="slide"]:not([hidden]) img')?.getAttribute('src')
    try {
      await act(() =>
        root.render(<MediaCarousel title="Atlas" items={ITEMS} onOpen={(i) => opened.push(i)} />),
      )
      const carousel = host.querySelector<HTMLElement>('[aria-roledescription="carousel"]')!
      expect(carousel.getAttribute('aria-label')).toBe('Atlas screenshots')
      expect(shown()).toBe('/shots/0.png')
      expect(host.textContent).toContain('The board')
      await act(() => button('Next screenshot').click())
      expect(shown()).toBe('/shots/1.png')
      expect(host.textContent).toContain('A finished game')
      await act(() =>
        carousel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
      )
      expect(shown()).toBe('/shots/0.png')
      await act(() => button('Screenshot 2 of 2').click())
      expect(shown()).toBe('/shots/1.png')
      await act(() => button('View screenshot 2 full size').click())
      expect(opened).toEqual([1])
    } finally {
      await React.act(async () => root.unmount())
      host.remove()
    }
  })
})
