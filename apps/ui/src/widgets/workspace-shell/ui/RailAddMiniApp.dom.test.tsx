import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

await mock.module('@/entities/mini-app-store/ui/MiniAppStore', () => ({
  MiniAppStore: () => <p data-testid="store">store</p>,
}))

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('the rail’s add button opens the mini app store', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RailAddMiniApp } = await import('./RailAddMiniApp')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<RailAddMiniApp />))
    const add = host.querySelector<HTMLButtonElement>('button[aria-label="Add mini apps"]')!
    expect(document.querySelector('[data-testid="store"]')).toBeNull()
    await act(async () => add.click())
    expect(document.querySelector('[data-testid="store"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Add mini apps')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
