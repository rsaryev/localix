import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('an app view an agent links opens on click, in its owner, and never on its own', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
  const { registerUiAnchor } = await import('@/shared/contrib/uiAnchors')
  const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
  const namespace = 'test-linked-board'
  const href = `localix://resource/${namespace}/game/s1`
  expect(
    registerUiAnchor({
      id: namespace,
      namespaces: [namespace],
      resolve: (candidate) =>
        candidate === href
          ? { kind: 'work-item', workKind: 'test-board', id: 'test-board:s1', title: 'Board' }
          : null,
    }),
  ).toBe(true)
  const requests: Array<{ kind: string; id?: string }> = []
  const stop = registerInspectorHandler((request) =>
    requests.push({ kind: request.kind, ...('id' in request ? { id: request.id } : {}) }),
  )
  const host = document.createElement('div')
  const mounted = createRoot(host)
  try {
    await act(async () =>
      mounted.render(
        <MemoryRouter>
          <MarkdownRendererImpl>{`[Open the board](${href})`}</MarkdownRendererImpl>
        </MemoryRouter>,
      ),
    )
    // Rendering the message opens nothing.
    expect(requests).toEqual([])
    const link = host.querySelector('a')
    expect(link?.getAttribute('href')).toBe(href)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => {
      link!.dispatchEvent(click)
    })
    expect(click.defaultPrevented).toBe(true)
    expect(requests).toEqual([{ kind: 'work-item', id: 'test-board:s1' }])

    // A view nobody owns stays text instead of a link that does nothing.
    await act(async () =>
      mounted.render(
        <MemoryRouter>
          <MarkdownRendererImpl>{'[Gone](localix://resource/nobody-owns/x)'}</MarkdownRendererImpl>
        </MemoryRouter>,
      ),
    )
    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).toContain('Gone')
  } finally {
    stop()
    await act(async () => mounted.unmount())
  }
})
