import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Message } from '../model/types'
import type { ToolCallItem } from '@localixai/agent/agents'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('assistant continuation card', () => {
  test('Sources chooses the real message when evidence spans several segments', async () => {
    const { act, createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { MessageSources } = await import('./MessageSources')
    const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
    const requests: unknown[] = []
    const unregister = registerInspectorHandler((request) => requests.push(request))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const evidence = (id: string): ToolCallItem[] => [
      {
        id,
        type: 'tool_call',
        status: 'completed',
        toolCallId: id,
        name: 'read',
        input: { path: `${id}.ts` },
        sources: [
          {
            id,
            kind: 'file',
            title: `${id}.ts`,
            uri: `file:///${id}.ts`,
            role: 'consulted',
            status: 'available',
          },
        ],
      } as ToolCallItem,
    ]
    const first = evidence('first')
    const second = evidence('second')
    try {
      await act(async () =>
        root.render(
          createElement(MessageSources, {
            items: [...first, ...second],
            messageId: 'second',
            sessionId: 'session',
            sourceTargets: [
              { messageId: 'first', items: first },
              { messageId: 'second', items: second },
            ],
          }),
        ),
      )
      expect(host.querySelectorAll('[data-sources-trigger]')).toHaveLength(1)
      await act(async () =>
        host
          .querySelector<HTMLButtonElement>('[data-sources-trigger]')
          ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
      )
      const target = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (item) => item.textContent?.includes('Segment 1'),
      )
      await act(async () => target?.click())
      expect(requests).toContainEqual({
        kind: 'message-replay',
        sessionId: 'session',
        messageId: 'first',
        section: 'sources',
      })
    } finally {
      unregister()
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keeps two bodies and ids under one article, header, footer and provenance boundary', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { MessageCard } = await import('./MessageCard')
    const { WorkItemSessionProvider } = await import('@localixai/plugin-sdk/ui/work-item-session')
    const { useMessageSearchStore } = await import('@/shared/lib/messageSearchBus')
    const { composerBus } = await import('@/shared/lib/composerBus')
    const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
    const inserts: unknown[] = []
    const inspectorRequests: unknown[] = []
    const unregisterInspector = registerInspectorHandler((request) =>
      inspectorRequests.push(request),
    )
    const unsubscribe = composerBus.subscribe((request) => {
      inserts.push(request)
    })
    const first = {
      id: 'first',
      role: 'assistant',
      from: 'agent:localix',
      content: 'Before the report',
      items: [
        {
          id: 'tool-first',
          type: 'tool_call',
          status: 'completed',
          toolCallId: 'call-first',
          name: 'read',
          activeVerb: 'Reading',
          input: { path: 'first.ts' },
          sources: [
            {
              id: 'source-first',
              kind: 'file',
              title: 'first.ts',
              uri: 'file:///first.ts',
              role: 'consulted',
              status: 'available',
            },
          ],
        } as ToolCallItem,
        { id: 'text-first', type: 'text', text: 'Before the report' },
      ],
    } as Message
    const second = {
      ...first,
      id: 'second',
      content: 'After the report',
      continuedFromMessageId: 'first',
      items: undefined,
    } as Message
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <WorkItemSessionProvider sessionId="session">
              <MessageCard
                message={second}
                segments={[first, second]}
                segmentSessionId="session"
                segmentWakeSources={[undefined, 'plugin']}
                isLast
              />
            </WorkItemSessionProvider>
          </MemoryRouter>,
        ),
      )
      expect(host.querySelectorAll('article')).toHaveLength(1)
      expect(host.querySelectorAll('.lx-message-footer')).toHaveLength(1)
      expect(host.querySelectorAll('[title^="Open @"]')).toHaveLength(1)
      expect(host.querySelector('[data-message-id="first"]')?.textContent).toContain(
        'Before the report',
      )
      expect(host.querySelector('[data-message-id="second"]')?.textContent).toContain(
        'After the report',
      )
      // The wake that joined mid-answer is a system line between the segments, not a caption.
      const wakeLine = host.querySelector('[data-message-id="second"] [role="status"]')
      expect(wakeLine?.textContent).toContain('Plugin update · continuing')
      expect(host.querySelectorAll('[data-sources-trigger]')).toHaveLength(1)
      expect(host.querySelector('[data-sources-trigger]')?.getAttribute('data-source-count')).toBe(
        '1',
      )
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[data-sources-trigger]')?.click(),
      )
      expect(inspectorRequests).toContainEqual({
        kind: 'message-replay',
        sessionId: 'session',
        messageId: 'first',
        section: 'sources',
      })
      const link = host.querySelector<HTMLButtonElement>(
        '[aria-label="Link answer segment to chat"]',
      )
      expect(link).not.toBeNull()
      await act(async () =>
        link?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
      )
      expect(document.body.textContent).toContain('Segment 1')
      expect(document.body.textContent).toContain('Segment 2')
      const segmentOne = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent === 'Segment 1')
      await act(async () => segmentOne?.click())
      expect(inserts).toHaveLength(1)
      expect(JSON.stringify(inserts[0])).toContain('first')
      expect(JSON.stringify(inserts[0])).not.toContain('second')
      await act(async () => useMessageSearchStore.getState().setActiveId('second'))
      expect(host.querySelector('[data-message-id="second"]')?.className).toContain(
        'lx-search-match',
      )
    } finally {
      unsubscribe()
      unregisterInspector()
      await act(async () => root.unmount())
      host.remove()
      useMessageSearchStore.getState().setActiveId(null)
    }
  })
})
