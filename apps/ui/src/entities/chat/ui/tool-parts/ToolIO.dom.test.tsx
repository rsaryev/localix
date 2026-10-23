import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('tool I/O actions', () => {
  test('keeps highlighted JSON lossless and opens its file link in the originating session', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
    const { WorkItemSessionProvider } = await import('@localixai/plugin-sdk/ui/work-item-session')
    const { OutputBlock } = await import('./ToolIO')
    const requests: unknown[] = []
    const unregister = registerInspectorHandler((request) => requests.push(request))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const source = '{\n  "path": "/workspace/a.ts:42",\n  "ok": true\n}\n'
    try {
      await act(async () =>
        root.render(
          <WorkItemSessionProvider sessionId="syntax-session">
            <OutputBlock linkify>{source}</OutputBlock>
          </WorkItemSessionProvider>,
        ),
      )
      expect(host.querySelector('pre')?.textContent).toBe(source)
      expect(host.querySelector('.sh__token--keyword')?.textContent).toBe('true')
      const link = host.querySelector<HTMLButtonElement>('[data-slot="text-action"]')!
      expect(link.textContent).toBe('/workspace/a.ts:42')
      await act(async () => link.click())
      expect(requests).toMatchObject([{ path: '/workspace/a.ts', sessionId: 'syntax-session' }])
    } finally {
      unregister()
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('opens inline and truncated file targets through native text actions', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
    const { WorkItemSessionProvider } = await import('@localixai/plugin-sdk/ui/work-item-session')
    const { useChatStore } = await import('../../model/store')
    const { FileLink, LinkedText } = await import('./ToolIO')
    const calls: Array<{ kind: string; sessionId?: string; path?: string; line?: number }> = []
    const unregister = registerInspectorHandler((request) => calls.push(request))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    // The transcript belongs to chat-b while chat-a is on screen: the links must open in chat-b.
    useChatStore.setState({ activeSessionId: 'chat-a' })

    try {
      await act(async () =>
        root.render(
          <WorkItemSessionProvider sessionId="chat-b">
            <pre>
              <LinkedText text="at src/app.ts:42 now" />
            </pre>
            <FileLink path="/workspace/docs/guide.md" line={7} />
          </WorkItemSessionProvider>,
        ),
      )

      const actions = Array.from(
        host.querySelectorAll<HTMLButtonElement>('button[data-slot="text-action"]'),
      )
      expect(actions).toHaveLength(2)
      expect(actions[0].textContent).toBe('src/app.ts:42')
      expect(actions[0].getAttribute('role')).toBeNull()
      expect(actions[0].getAttribute('title')).toBeNull()
      expect(actions[0].getAttribute('data-tooltip-trigger')).toBe('true')

      await act(async () => actions[0].click())
      await act(async () => actions[1].click())
      expect(calls).toEqual([
        { kind: 'file', sessionId: 'chat-b', path: 'src/app.ts', line: 42 },
        { kind: 'file', sessionId: 'chat-b', path: '/workspace/docs/guide.md', line: 7 },
      ])

      await act(async () => actions[0].focus())
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
        'Open src/app.ts:42',
      )
    } finally {
      unregister()
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('a file link outside any chat opens nothing — never the chat on screen', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
    const { useChatStore } = await import('../../model/store')
    const { FileLink } = await import('./ToolIO')
    const calls: unknown[] = []
    const unregister = registerInspectorHandler((request) => calls.push(request))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    useChatStore.setState({ activeSessionId: 'chat-a' })

    try {
      await act(async () => root.render(<FileLink path="/workspace/a.ts" line={3} />))
      const link = host.querySelector<HTMLButtonElement>('button[data-slot="text-action"]')!
      await act(async () => link.click())
      expect(calls).toEqual([])
    } finally {
      unregister()
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('renders a stable icon toolbar action without toggling its containing row', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { GitCompare } = await import('lucide-react')
    const { ToolHeaderAction } = await import('./ToolIO')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let actionCalls = 0
    let rowCalls = 0

    try {
      await act(async () =>
        root.render(
          <div onClick={() => rowCalls++}>
            <ToolHeaderAction icon={GitCompare} label="Open diff" onClick={() => actionCalls++} />
          </div>,
        ),
      )

      const button = host.querySelector<HTMLButtonElement>('button[aria-label="Open diff"]')!
      expect(button).not.toBeNull()
      expect(button.textContent).toBe('')
      expect(button.getAttribute('data-slot')).toBe('button')
      expect(button.getAttribute('data-size')).toBe('icon-xs')
      expect(button.getAttribute('data-tooltip-trigger')).toBe('true')
      expect(button.getAttribute('title')).toBeNull()

      await act(async () => button.click())
      expect(actionCalls).toBe(1)
      expect(rowCalls).toBe(0)

      await act(async () => button.focus())
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Open diff')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keeps a disabled danger action explainable but inert', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { Square } = await import('lucide-react')
    const { ToolHeaderAction } = await import('./ToolIO')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let calls = 0

    try {
      await act(async () =>
        root.render(
          <ToolHeaderAction
            icon={Square}
            label="Stopping worker…"
            onClick={() => calls++}
            tone="danger"
            disabled
          />,
        ),
      )

      const button = host.querySelector<HTMLButtonElement>('button')!
      const anchor = host.querySelector<HTMLElement>('[data-disabled-tooltip-anchor]')!
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('title')).toBeNull()
      expect(anchor.tabIndex).toBe(0)

      await act(async () => button.click())
      expect(calls).toBe(0)

      await act(async () => anchor.focus())
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
        'Stopping worker…',
      )
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
