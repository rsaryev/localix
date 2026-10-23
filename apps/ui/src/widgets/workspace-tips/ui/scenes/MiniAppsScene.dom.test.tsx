import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { registerInspectorHandler } from '@/shared/lib/inspectorBus'
import type { InspectorRequest } from '@/shared/lib/inspectorBusContracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('setup offers the mini app store, and its choice opens the store tab', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WORKSPACE_TIPS } = await import('../workspaceTips')
  const tip = WORKSPACE_TIPS.find((entry) => entry.id === 'mini-apps')!
  expect(tip.lead).toBe('Add mini apps.')
  const Action = tip.Action!
  const opened: InspectorRequest[] = []
  const unregister = registerInspectorHandler((request) => void opened.push(request))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Action />))
    const open = host.querySelector<HTMLButtonElement>('button')!
    expect(open.textContent).toContain('the store')
    await act(async () => open.click())
    expect(opened).toEqual([expect.objectContaining({ workKind: 'mini-app-store' })])
  } finally {
    unregister()
    await act(async () => root.unmount())
    host.remove()
  }
})
