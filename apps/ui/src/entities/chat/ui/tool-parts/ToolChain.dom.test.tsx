import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ToolCallItem } from '@localixai/agent/agents'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const tool = (id: string, status: ToolCallItem['status']): ToolCallItem => ({
  id,
  type: 'tool_call',
  status,
  toolCallId: `call-${id}`,
  name: 'read',
  activeVerb: 'Reading',
  input: { path: `${id}.ts` },
})

describe('ToolChain live disclosure', () => {
  test('opens a collapsed chain and highlights the exact Event Center tool target', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemSessionProvider } = await import('@localixai/plugin-sdk/ui/work-item-session')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
    const { requestEventFocus, useEventFocusStore } = await import('@/shared/lib/eventFocusBus')
    const { ToolChain } = await import('./ToolChain')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      requestEventFocus({
        kind: 'resource',
        sessionId: 'session-a',
        projectId: null,
        resourceKind: 'tool',
        resourceId: 'call-target',
      })
      await act(async () =>
        root.render(
          <WorkItemSessionProvider sessionId="session-a">
            <WorkItemVisibilityProvider visible={false}>
              <ToolChain items={[tool('other', 'completed'), tool('target', 'completed')]} />
            </WorkItemVisibilityProvider>
          </WorkItemSessionProvider>,
        ),
      )

      expect(host.querySelector('[aria-label^="Expand tool chain"]')).not.toBeNull()
      expect(host.querySelector('[data-event-tool-target="call-target"]')).toBeNull()

      await act(async () =>
        root.render(
          <WorkItemSessionProvider sessionId="session-a">
            <WorkItemVisibilityProvider visible>
              <ToolChain items={[tool('other', 'completed'), tool('target', 'completed')]} />
            </WorkItemVisibilityProvider>
          </WorkItemSessionProvider>,
        ),
      )

      expect(host.querySelector('[aria-label^="Collapse tool chain"]')).not.toBeNull()
      expect(host.querySelector('[data-event-tool-target="call-target"]')?.className).toContain(
        'lx-target-reveal',
      )
      expect(host.querySelector('[data-event-tool-target="call-other"]')?.className).not.toContain(
        'lx-target-reveal',
      )
    } finally {
      await act(async () => {
        useEventFocusStore.setState({ pending: null, active: null, sequence: 0 })
        root.unmount()
      })
      host.remove()
    }
  })

  test('can be collapsed and reopened while a tool is still running', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ToolChain } = await import('./ToolChain')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <ToolChain items={[tool('done', 'completed'), tool('live', 'running')]} isLatest />,
        ),
      )
      const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
      const track = toggle.parentElement!
      expect(toggle.disabled).toBe(false)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(toggle.getAttribute('aria-label')).toStartWith('Collapse tool chain')
      expect(track.getAttribute('class')).toContain('border-l')
      expect(track.getAttribute('class')).not.toContain('rounded-xl')
      expect(track.getAttribute('class')).not.toContain('bg-surface-raised')

      await act(async () => toggle.click())
      const body = toggle.nextElementSibling as HTMLElement
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.getAttribute('aria-label')).toStartWith('Expand tool chain')
      expect(body.getAttribute('aria-hidden')).toBe('true')
      expect(body.hasAttribute('inert')).toBe(true)

      await act(async () => toggle.click())
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(body.hasAttribute('inert')).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('a non-latest live chain starts collapsed but remains operable', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ToolChain } = await import('./ToolChain')
    const host = document.createElement('div')
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(<ToolChain items={[tool('done-2', 'completed'), tool('live-2', 'running')]} />),
      )
      const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
      expect(toggle.disabled).toBe(false)
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      await act(async () => toggle.click())
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
    } finally {
      await act(async () => root.unmount())
    }
  })

  // The transcript jumped while the agent worked: each call opened something and each finish
  // shut it, and a chain's second call remounted its first card. This replays a run the way it
  // streams — A done; A done, B running; B done, C running; all done — and holds the rule that
  // a new call only appends or updates in place.
  test('a run of calls never opens or closes a row on its own, nor remounts an earlier card', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ToolChain } = await import('./ToolChain')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const call = (name: string, id: string, status: ToolCallItem['status']): ToolCallItem => ({
      ...tool(id, status),
      name,
      activeVerb: 'Running',
    })
    const steps: ToolCallItem[][] = [
      [call('probe_a', 'a', 'completed')],
      [call('probe_a', 'a', 'completed'), call('probe_b', 'b', 'running')],
      [
        call('probe_a', 'a', 'completed'),
        call('probe_b', 'b', 'completed'),
        call('probe_c', 'c', 'running'),
      ],
      [
        call('probe_a', 'a', 'completed'),
        call('probe_b', 'b', 'completed'),
        call('probe_c', 'c', 'completed'),
      ],
    ]
    const rowToggles = () =>
      [...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].filter(
        (button) => !button.getAttribute('aria-label')?.includes('tool chain'),
      )

    try {
      let firstCard: Element | null = null
      for (const items of steps) {
        await act(async () => root.render(<ToolChain items={items} isLatest isRunning />))
        const cardA = host.querySelector('[data-event-tool-target="call-a"]')
        expect(cardA).not.toBeNull()
        firstCard ??= cardA
        expect(cardA).toBe(firstCard)
        expect(rowToggles().map((button) => button.getAttribute('aria-expanded'))).not.toContain(
          'true',
        )
      }
      expect(
        host.querySelector('[aria-label^="Collapse tool chain"]')?.getAttribute('aria-expanded'),
      ).toBe('true')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('a stack stays folded while its next call runs, and names that call', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ToolChain } = await import('./ToolChain')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <ToolChain items={[tool('first', 'completed'), tool('second', 'running')]} isLatest />,
        ),
      )
      const stack = [...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(
        (button) => !button.getAttribute('aria-label')?.includes('tool chain'),
      )!
      expect(stack.getAttribute('aria-expanded')).toBe('false')
      expect(stack.textContent).toContain('second.ts')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('does not request deferred details until expansion, then renders the full cards', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemSessionProvider } = await import('@localixai/plugin-sdk/ui/work-item-session')
    const { ToolChain } = await import('./ToolChain')
    const host = document.createElement('div')
    const root = createRoot(host)
    const originalFetch = globalThis.fetch
    let fetchCount = 0
    const deferredTool = (id: string) => ({
      ...tool(id, 'completed'),
      name: 'custom_tool',
      activeVerb: 'Running',
    })
    globalThis.fetch = (async () => {
      fetchCount += 1
      return new Response(
        JSON.stringify({
          items: [
            { ...deferredTool('deferred-a'), resultText: 'full result A' },
            { ...deferredTool('deferred-b'), resultText: 'full result B' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    try {
      await act(async () =>
        root.render(
          <WorkItemSessionProvider sessionId="session-a">
            <ToolChain
              items={[deferredTool('deferred-a'), deferredTool('deferred-b')]}
              messageId="message-a"
              deferredToolItemIds={['deferred-a', 'deferred-b']}
            />
          </WorkItemSessionProvider>,
        ),
      )
      expect(fetchCount).toBe(0)
      expect(host.textContent).not.toContain('full result')

      const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
      await act(async () => {
        toggle.click()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchCount).toBe(1)
      // Two calls of one tool fold into one stack row; open it, then the first card.
      const stack = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!
      await act(async () => stack.click())
      const firstCard = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!
      await act(async () => firstCard.click())
      expect(host.textContent).toContain('full result A')
    } finally {
      globalThis.fetch = originalFetch
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
