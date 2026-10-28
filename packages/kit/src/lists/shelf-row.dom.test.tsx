import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('ShelfRow', () => {
  test('a titled row: See all opens the whole list, arrows page it only where more is hidden', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { ShelfRow } = await import('./shelf-row')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const seen: string[] = []
    await React.act(async () =>
      root.render(
        <ShelfRow
          title="Plugins"
          subtitle="What Claude Code can add"
          perView={4}
          onSeeAll={() => seen.push('all')}
        >
          {['a', 'b', 'c', 'd', 'e', 'f'].map((id) => (
            <span key={id}>{id}</span>
          ))}
        </ShelfRow>,
      ),
    )
    const section = host.querySelector('section')!
    expect(section.getAttribute('aria-label')).toBe('Plugins')
    expect(section.querySelector('h2')?.textContent).toBe('Plugins')
    expect(section.textContent).toContain('What Claude Code can add')
    expect(section.querySelectorAll('li')).toHaveLength(6)
    const button = (name: string) =>
      section.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
    button('See all Plugins').click()
    expect(seen).toEqual(['all'])

    // Nothing measured yet: everything fits, both arrows are off and nothing fades.
    const strip = section.querySelector<HTMLElement>('ul')!
    expect(button('Scroll Plugins forward').disabled).toBe(true)
    expect(strip.dataset.fade).toBeUndefined()

    // Wider than it shows, at the start: forward pages by most of a view, and the end fades.
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 1500 })
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 1000 })
    const moves: number[] = []
    strip.scrollBy = ((options: ScrollToOptions) => void moves.push(options.left ?? 0)) as never
    await React.act(async () => void strip.dispatchEvent(new Event('scroll')))
    expect(button('Scroll Plugins back').disabled).toBe(true)
    expect(button('Scroll Plugins forward').disabled).toBe(false)
    expect(strip.dataset.fade).toBe('end')
    button('Scroll Plugins forward').click()
    expect(moves[0]).toBeGreaterThan(800)

    strip.scrollLeft = 500
    await React.act(async () => void strip.dispatchEvent(new Event('scroll')))
    expect(button('Scroll Plugins forward').disabled).toBe(true)
    expect(strip.dataset.fade).toBe('start')
    button('Scroll Plugins back').click()
    expect(moves[1]).toBeLessThan(-800)

    await React.act(async () => root.unmount())
    host.remove()
  })

  test('as a grid, whole tiles wrap into its columns, as many rows as it allows, with no sideways scroll', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { ShelfRow } = await import('./shelf-row')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await React.act(async () =>
      root.render(
        <ShelfRow title="Mini apps" columns={3} rows={2} onSeeAll={() => {}}>
          {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => (
            <span key={id}>{id}</span>
          ))}
        </ShelfRow>,
      ),
    )
    const section = host.querySelector('section')!
    const grid = section.querySelector<HTMLElement>('ul')!
    expect([...grid.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ])
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))')
    expect(grid.className).not.toContain('overflow-x-auto')
    expect(section.querySelector('[aria-label^="Scroll"]')).toBeNull()
    expect(section.querySelector('button[aria-label="See all Mini apps"]')).not.toBeNull()

    await React.act(async () => root.unmount())
    host.remove()
  })
})
