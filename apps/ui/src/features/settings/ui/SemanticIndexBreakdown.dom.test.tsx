import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const collection = (name: string, label: string, items: number, building?: [number, number]) => ({
  name,
  label,
  items,
  chunks: items,
  scanned: building?.[0] ?? null,
  total: building?.[1] ?? null,
  reconciling: !!building,
})

describe('SemanticIndexBreakdown — the index by category', () => {
  test('lists every category by size, a build with its progress', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { SemanticIndexBreakdown } = await import('./SemanticIndexBreakdown')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <SemanticIndexBreakdown
            collections={[
              collection('chat.sessions', 'Chats', 48),
              collection('plugin:board:cards', 'Cards', 3, [1, 4]),
              collection('chat.messages', 'Messages', 161),
            ]}
          />,
        ),
      )
      expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'Messages161',
        'Chats48',
        'Cards25%3',
      ])
      expect(
        [...host.querySelectorAll('[role="progressbar"]')].map((bar) =>
          bar.getAttribute('aria-label'),
        ),
      ).toEqual([
        'Messages share of the index',
        'Chats share of the index',
        'Cards indexing progress',
      ])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
