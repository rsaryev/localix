import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

async function render(node: () => ReactNode) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(node()))
  return {
    host,
    click: (element: Element | null) =>
      React.act(async () => (element as HTMLElement | null)?.click()),
    done: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('ItemCard and CardGrid', () => {
  test('the whole card opens, while its own controls act on their own', async () => {
    const opened: string[] = []
    const pressed: string[] = []
    const { CardGridSection } = await import('./card-grid')
    const { ItemCard } = await import('./item-card')
    const view = await render(() => (
      <CardGridSection title="Featured" count={1}>
        <ItemCard
          data-item="chess"
          title="Chess"
          openLabel="Chess"
          tile={<span data-testid="tile" />}
          description="Legal moves"
          footer={
            <button type="button" onClick={() => pressed.push('tag')}>
              game
            </button>
          }
          actions={
            <button type="button" onClick={() => pressed.push('install')}>
              Install
            </button>
          }
          onOpen={() => opened.push('chess')}
        />
      </CardGridSection>
    ))
    try {
      const section = view.host.querySelector('section')!
      expect(section.getAttribute('aria-label')).toBe('Featured')
      expect(section.querySelector('h2')?.textContent).toContain('Featured')
      expect(section.querySelector('h2')?.textContent).toContain('1')
      const card = view.host.querySelector('[data-item="chess"]')!
      expect(card.tagName).toBe('LI')
      const open = card.querySelector<HTMLButtonElement>('button[aria-label="Chess"]')!
      expect(open.getAttribute('aria-describedby')).toBe(
        card.querySelector('p[id]')?.getAttribute('id') ?? null,
      )
      await view.click(open)
      const [tag, install] = [...card.querySelectorAll('button')].filter(
        (b) => !b.hasAttribute('aria-label'),
      )
      await view.click(tag!)
      await view.click(install!)
      expect(opened).toEqual(['chess'])
      expect(pressed).toEqual(['tag', 'install'])
    } finally {
      await view.done()
    }
  })

  test('a note replaces the description', async () => {
    const { ItemCard } = await import('./item-card')
    const view = await render(() => (
      <ul>
        <ItemCard
          title="Radio"
          openLabel="Radio"
          description="Music"
          note="It failed"
          onOpen={() => {}}
        />
      </ul>
    ))
    try {
      const line = view.host.querySelector('p[id]')!
      expect(line.textContent).toBe('It failed')
      expect(view.host.textContent).not.toContain('Music')
    } finally {
      await view.done()
    }
  })
})
