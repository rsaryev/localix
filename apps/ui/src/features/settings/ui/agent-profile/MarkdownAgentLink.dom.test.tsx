import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('chat profile links resolve through the owner and never navigate the webview', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: MarkdownRendererImpl } = await import('@/shared/ui/MarkdownRendererImpl')
  const { registerUiLocation, unregisterUiLocation } = await import('@/shared/contrib/uiLocations')
  const { default: profile } = await import('./AgentProfileTab.surface')
  const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
  expect(registerUiLocation(profile)).toBe(true)
  const requests: unknown[] = []
  const stop = registerInspectorHandler((request) => requests.push(request))
  const host = document.createElement('div')
  const mounted = createRoot(host)
  try {
    for (const [href, expected] of [
      [
        'localix://ui/work-item/agent?agent=&scope=p&handle=qa',
        {
          id: 'agent:new:p',
          title: 'New agent',
          payload: { agentId: '', projectId: 'p', initialHandle: 'qa' },
        },
      ],
      [
        'localix://ui/work-item/agent?agent=native%3Aqa&scope=p&section=rules',
        {
          id: 'agent:profile:p:native:qa',
          title: 'Native:qa',
          payload: {
            agentId: 'native:qa',
            projectId: 'p',
            section: 'rules',
            sectionRequestId: expect.any(String),
          },
        },
      ],
    ] as const) {
      await act(async () =>
        mounted.render(<MarkdownRendererImpl>{`[Open profile](${href})`}</MarkdownRendererImpl>),
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
        workKind: 'agent',
        scope: null,
        ...expected,
      })
    }
    // Removing the owner withdraws the live link; no fallback navigation exists.
    await act(async () => {
      unregisterUiLocation(profile.id)
    })
    expect(host.querySelector('a')).toBeNull()
  } finally {
    await act(async () => {
      mounted.unmount()
    })
    unregisterUiLocation(profile.id)
    stop()
  }
})
