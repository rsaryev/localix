import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'
let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})
test('visual selection exposes its state and disabled options cannot fire', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SelectionTile } = await import('./selection-tile')
  const host = document.createElement('div')
  const root = createRoot(host)
  let selected = 0
  try {
    await act(async () =>
      root.render(
        <>
          <SelectionTile selected aria-label="Current template" onClick={() => selected++}>
            Preview
          </SelectionTile>
          <SelectionTile disabled aria-label="Unavailable template" onClick={() => selected++}>
            Preview
          </SelectionTile>
        </>,
      ),
    )
    const buttons = host.querySelectorAll('button')
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true')
    await act(async () => {
      buttons[0]!.click()
      buttons[1]!.click()
    })
    expect(selected).toBe(1)
  } finally {
    await act(async () => root.unmount())
  }
})
