import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(() => jest.useRealTimers())

const SLIDES = ['Code Graph', 'Kanban', 'Supabase'].map((title) => ({
  id: title,
  eyebrow: 'Mini app',
  title,
  pitch: `${title} pitch`,
  media: <span>{title} picture</span>,
  footer: <button type="button">Get {title}</button>,
}))

async function mount(props: { interval?: number }) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { HeroCarousel } = await import('./hero-carousel')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () =>
    root.render(<HeroCarousel label="Featured" slides={SLIDES} layout="wide" {...props} />),
  )
  const shown = () =>
    host.querySelector('[aria-roledescription="slide"]:not([hidden]) h3')?.textContent
  const button = (name: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
  const act = (run: () => void) => React.act(async () => run())
  const done = async () => {
    await React.act(async () => root.unmount())
    host.remove()
  }
  return { host, shown, button, act, done }
}

describe('HeroCarousel', () => {
  test('pages by arrows, keys, swipe and dots; each slide carries its own action', async () => {
    const view = await mount({ interval: 0 })
    const region = view.host.querySelector<HTMLElement>('[aria-roledescription="carousel"]')!
    expect(region.getAttribute('aria-label')).toBe('Featured')
    expect(view.shown()).toBe('Code Graph')
    expect(view.host.textContent).toContain('Code Graph pitch')
    await view.act(() => view.button('Next').click())
    expect(view.shown()).toBe('Kanban')
    await view.act(() =>
      region.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    )
    expect(view.shown()).toBe('Supabase')
    await view.act(() => {
      region.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }))
      region.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, bubbles: true }))
    })
    expect(view.shown()).toBe('Kanban')
    await view.act(() => view.button('Show slide 1 of 3').click())
    expect(view.shown()).toBe('Code Graph')
    expect(view.button('Show slide 1 of 3').getAttribute('aria-current')).toBe('true')
    await view.done()
  })

  test('advances on its own, wrapping, and holds still while the pointer rests on it', async () => {
    jest.useFakeTimers()
    const view = await mount({ interval: 5000 })
    await view.act(() => jest.advanceTimersByTime(5000))
    expect(view.shown()).toBe('Kanban')
    await view.act(() => jest.advanceTimersByTime(10_000))
    expect(view.shown()).toBe('Code Graph')
    const region = view.host.querySelector<HTMLElement>('[aria-roledescription="carousel"]')!
    await view.act(() => region.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })))
    await view.act(() => jest.advanceTimersByTime(20_000))
    expect(view.shown()).toBe('Code Graph')
    await view.done()
  })
})
