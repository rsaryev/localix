import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import { registerSessionSurface, SessionSurface } from './sessionSurfaces'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function render(node: unknown) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node as React.ReactNode))
  return {
    html: host.innerHTML,
    async close() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

/**
 * A contributed surface is mounted by the HOST, so a throw inside one does not fail politely — it
 * unwinds into whatever boundary is nearest, which for the chat shell is the ROUTE. The user sees
 * "This view could not load" and no component name, so the cheapest signal is a test that actually
 * mounts one.
 *
 * These render real React, not a registry assertion, because the failures worth catching here are
 * render-time: a hook that subscribes to an unstable snapshot, a runtime accessor read before the
 * host bound it, a component that assumes a session id is present.
 */
describe('contributed session surfaces', () => {
  test('an unfilled surface renders nothing and disturbs nothing around it', async () => {
    const view = await render(
      <div data-testid="shell">
        <SessionSurface surface="nobody.fills.this" sessionId="s1" />
      </div>,
    )
    try {
      expect(view.html).toContain('data-testid="shell"')
    } finally {
      await view.close()
    }
  })

  test('a contribution receives the session and the surface context verbatim', async () => {
    registerSessionSurface({
      surface: 'test.context',
      pluginName: 'fixture',
      Component: ({ sessionId, context }: { sessionId: string | null; context?: unknown }) => (
        <span data-session={sessionId ?? 'none'} data-context={JSON.stringify(context ?? null)} />
      ),
    })
    const view = await render(
      <SessionSurface surface="test.context" sessionId="s1" context={{ focused: true }} />,
    )
    try {
      expect(view.html).toContain('data-session="s1"')
      // The context is the surface's own vocabulary and reaches the plugin unchanged — the git
      // poller reads an `isolationToken` from here, and dropping it silently costs a refresh.
      expect(view.html).toContain('{&quot;focused&quot;:true}')
    } finally {
      await view.close()
    }
  })

  test('a null session still mounts — a surface decides for itself what that means', async () => {
    registerSessionSurface({
      surface: 'test.nullable',
      pluginName: 'fixture',
      Component: ({ sessionId }: { sessionId: string | null }) => (
        <span data-session={String(sessionId)} />
      ),
    })
    const view = await render(<SessionSurface surface="test.nullable" sessionId={null} />)
    try {
      expect(view.html).toContain('data-session="null"')
    } finally {
      await view.close()
    }
  })
})
