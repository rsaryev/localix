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

test('setup offers the mini app catalog, and its choice opens the store', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WORKSPACE_TIPS } = await import('../workspaceTips')
  const tip = WORKSPACE_TIPS.find((entry) => entry.id === 'mini-apps')!
  expect(tip.lead).toBe('Add mini apps.')
  const Action = tip.Action!
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Action />))
    const open = host.querySelector<HTMLButtonElement>('button')!
    expect(open.textContent).toContain('the catalog')
    await act(async () => open.click())
    expect(document.querySelector('[data-testid="store"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
