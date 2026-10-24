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

test('the rail’s add button opens the Store on its Mini apps shelf, in its own tab', async () => {
  const opened: InspectorRequest[] = []
  const unregister = registerInspectorHandler((request) => void opened.push(request))
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RailAddMiniApp } = await import('./RailAddMiniApp')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<RailAddMiniApp />))
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Add mini apps"]')!.click(),
    )
    expect(opened).toEqual([
      expect.objectContaining({
        kind: 'work-item',
        workKind: 'store',
        id: 'store',
        scope: null,
        payload: { shelf: 'package:mini-app' },
      }),
    ])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  } finally {
    unregister?.()
    await act(async () => root.unmount())
    host.remove()
  }
})
