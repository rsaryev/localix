import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

// The level scales the coats over the macOS window material. A browser, Windows or Linux window
// has no material and is always solid, so a slider there would change nothing.
test('Window transparency is not offered where the window has no material', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { TransparencyField } = await import('./TransparencyField')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<TransparencyField />))
  expect(host.querySelector('[aria-label="Window transparency"]')).toBeNull()
  expect(host.textContent).toBe('')
  await act(async () => root.unmount())
  host.remove()
})
