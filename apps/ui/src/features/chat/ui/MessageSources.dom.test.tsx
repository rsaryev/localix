import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { AgentItem } from '@localixai/agent/agents'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('MessageSources presentation', () => {
  test('opens the unified Activity inspector at Sources instead of expanding inline', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { MessageSources } = await import('./MessageSources')
    const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
    const item = {
      id: 'tool-1',
      type: 'tool_call',
      toolCallId: 'tool-1',
      name: 'web',
      activeVerb: 'Searching',
      status: 'completed',
      sources: [
        {
          id: 'source-1',
          kind: 'web',
          title: 'Primary source',
          uri: 'https://example.com/source',
          role: 'cited',
          status: 'available',
        },
      ],
    } as AgentItem

    const requests: unknown[] = []
    const stop = registerInspectorHandler((request) => requests.push(request))

    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <MemoryRouter>
          <MessageSources items={[item]} messageId="m-1" sessionId="s-1" />
        </MemoryRouter>,
      ),
    )

    // The list used to expand in place and later lived in a modal drawer. Both moved the user's
    // attention away from the answer; the flat Activity work item keeps the transcript visible.
    expect(host.querySelector('[data-source-list]')).toBeNull()
    expect(host.querySelector('details')).toBeNull()

    const trigger = host.querySelector<HTMLButtonElement>('[data-sources-trigger]')
    expect(trigger?.textContent).toContain('Sources')
    expect(trigger?.dataset.sourceCount).toBe('1')
    expect(trigger?.getAttribute('aria-label')).toBe('Open sources, 1')

    await act(async () => {
      trigger?.click()
    })
    expect(requests.at(-1)).toEqual({
      kind: 'message-replay',
      sessionId: 's-1',
      messageId: 'm-1',
      section: 'sources',
    })

    await act(async () => root.unmount())
    stop()
  })

  test('an answer with no evidence shows no trigger at all', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { MessageSources } = await import('./MessageSources')

    // `MessageCard` renders this under EVERY assistant message, so the empty guard is what keeps a
    // dead "Sources 0" affordance off every answer in the transcript. Removing it broke no test.
    const searchOnly = {
      id: 'tool-1',
      type: 'tool_call',
      toolCallId: 'tool-1',
      name: 'search',
      status: 'completed',
      // Discovered and failed records are real registry entries, and deliberately not evidence —
      // so this message contributes nothing to an ANSWER and must not advertise otherwise.
      sources: [
        {
          id: 'source-1',
          kind: 'file',
          title: 'found.ts',
          uri: 'localix://ui/work-item/file?path=found.ts',
          role: 'discovered',
          status: 'available',
        },
        {
          id: 'source-2',
          kind: 'file',
          title: 'broken.ts',
          uri: 'localix://ui/work-item/file?path=broken.ts',
          role: 'consulted',
          status: 'failed',
        },
      ],
    } as AgentItem

    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <MemoryRouter>
          <MessageSources items={[searchOnly]} messageId="m-1" />
        </MemoryRouter>,
      ),
    )

    expect(host.querySelector('[data-sources-trigger]')).toBeNull()
    expect(host.textContent).toBe('')

    await act(async () => root.unmount())
  })

  test('a message with no items renders nothing', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { MessageSources } = await import('./MessageSources')

    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <MemoryRouter>
          <MessageSources items={undefined} messageId="m-1" />
        </MemoryRouter>,
      ),
    )

    expect(host.textContent).toBe('')

    await act(async () => root.unmount())
  })
})
