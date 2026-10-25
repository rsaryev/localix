import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('a chat’s agent link opens that agent in the Store and never navigates the webview', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: MarkdownRendererImpl } = await import('@/shared/ui/MarkdownRendererImpl')
  const { registerUiLocation, unregisterUiLocation } = await import('@/shared/contrib/uiLocations')
  const { default: store } = await import('./StorePage.surface')
  const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
  expect(registerUiLocation(store)).toBe(true)
  const requests: unknown[] = []
  const stop = registerInspectorHandler((request) => requests.push(request))
  const host = document.createElement('div')
  const mounted = createRoot(host)
  try {
    for (const [href, expected] of [
      [
        'localix://ui/work-item/store?kind=agent&id=native%3Aqa',
        { payload: { ref: { kind: 'agent', id: 'native:qa' } } },
      ],
    ] as const) {
      await act(async () =>
        mounted.render(<MarkdownRendererImpl>{`[Open store](${href})`}</MarkdownRendererImpl>),
      )
      const link = host.querySelector('a')
      expect(link?.getAttribute('href')).toBe(href)
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      await act(async () => {
        link!.dispatchEvent(click)
      })
      expect(click.defaultPrevented).toBe(true)
      expect(requests.at(-1)).toEqual({
        kind: 'work-item',
        workKind: 'store',
        id: 'store',
        title: 'Store',
        scope: null,
        ...expected,
      })
    }
    // Removing the owner withdraws the live link; no fallback navigation exists.
    await act(async () => {
      unregisterUiLocation(store.id)
    })
    expect(host.querySelector('a')).toBeNull()
  } finally {
    await act(async () => {
      mounted.unmount()
    })
    unregisterUiLocation(store.id)
    stop()
  }
})
