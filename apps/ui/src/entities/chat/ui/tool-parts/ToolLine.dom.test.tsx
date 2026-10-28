import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

describe('ToolLine action layout', () => {
  test('keeps actions separate from the disclosure and preserves both click targets', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ToolLine } = await import('./ToolLine')
    const { ToolHeaderAction } = await import('./ToolIO')
    const { SquareTerminal } = await import('lucide-react')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let opened = 0

    try {
      await act(async () =>
        root.render(
          <ToolLine
            title="A long command label"
            badge={<span>BG</span>}
            headerActions={
              <ToolHeaderAction icon={SquareTerminal} label="Terminal" onClick={() => opened++} />
            }
          >
            Output
          </ToolLine>,
        ),
      )

      const disclosure = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
      const cluster = host.querySelector<HTMLElement>('[data-tool-action-cluster]')!
      const action = cluster.querySelector<HTMLButtonElement>('button')!
      expect(cluster.parentElement).toBe(disclosure.parentElement)
      expect(disclosure.contains(action)).toBe(false)
      expect(disclosure.textContent).toContain('BG')

      await act(async () => action.click())
      expect(opened).toBe(1)
      expect(disclosure.getAttribute('aria-expanded')).toBe('false')

      await act(async () => disclosure.click())
      expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})

const CALL = { toolCallId: 'tc_1', name: 'Read' }

describe('ToolLine as a drag source', () => {
  test('a dragged call carries the conversation it lives in', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ToolLine } = await import('./ToolLine')
    const { ToolCallDragContext } = await import('./toolCallDragContext')
    const { WorkItemSessionProvider } = await import('@localixai/mini-app-sdk/ui/work-item-session')
    const { readMessageBindingDrag } =
      await import('@localixai/mini-app-sdk/ui/message-binding-drag')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <WorkItemSessionProvider sessionId="s1">
            <ToolCallDragContext.Provider value={CALL}>
              <ToolLine title="login.ts">Output</ToolLine>
            </ToolCallDragContext.Provider>
          </WorkItemSessionProvider>,
        ),
      )
      const data = new Map<string, string>()
      const transfer = {
        types: [] as string[],
        effectAllowed: 'uninitialized',
        setData: (type: string, value: string) =>
          void (data.set(type, value), transfer.types.push(type)),
        getData: (type: string) => data.get(type) ?? '',
        setDragImage: () => undefined,
      }
      const header = host.querySelector<HTMLElement>('[draggable="true"]')!
      const event = new window.Event('dragstart', { bubbles: true })
      Object.defineProperty(event, 'dataTransfer', { value: transfer })
      await act(async () => header.dispatchEvent(event))
      expect(readMessageBindingDrag(transfer as unknown as DataTransfer)?.target).toMatchObject({
        kind: 'call',
        token: '@call:tc_1',
        attributes: { toolCallId: 'tc_1', sessionId: 's1' },
      })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function setBoxWidths(element: HTMLElement, clientWidth: number, scrollWidth: number) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
    clientHeight: { configurable: true, value: 16 },
    scrollHeight: { configurable: true, value: 16 },
  })
}

describe('ToolLine managed title details', () => {
  test('opens the same managed detail from pointer hover over the text track', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TooltipProvider } = await import('@localixai/kit/tooltip')
    const { ToolLine } = await import('./ToolLine')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <TooltipProvider delayDuration={0}>
            <ToolLine title="server.ts" titleDetails="/workspace/apps/api/src/server.ts">
              Output
            </ToolLine>
          </TooltipProvider>,
        ),
      )

      const title = host.querySelector<HTMLElement>('[data-slot="tool-line-title"]')!
      const textTrack = title.parentElement!
      await act(async () => {
        textTrack.dispatchEvent(
          new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
        )
        textTrack.dispatchEvent(
          new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
        '/workspace/apps/api/src/server.ts',
      )
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('describes the keyboard-focused disclosure with richer title detail', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ToolLine } = await import('./ToolLine')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <ToolLine
            title="server.ts"
            titleDetails="/workspace/apps/api/src/server.ts"
            subtitle="Read 318 lines"
          >
            Output
          </ToolLine>,
        ),
      )

      const button = host.querySelector<HTMLButtonElement>('button')!
      expect(button.getAttribute('title')).toBeNull()
      expect(host.querySelector('[data-slot="tool-line-title"]')?.getAttribute('title')).toBeNull()
      expect(
        host.querySelector('[data-slot="tool-line-subtitle"]')?.getAttribute('title'),
      ).toBeNull()

      await act(async () => button.focus())

      const tooltip = document.body.querySelector<HTMLElement>('[role="tooltip"]')!
      expect(tooltip).not.toBeNull()
      expect(tooltip.textContent).toContain('/workspace/apps/api/src/server.ts')
      expect(tooltip.textContent).not.toContain('Read 318 lines')
      expect(button.getAttribute('aria-describedby')).toBe(tooltip.id)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('reveals only text that is actually clipped when no richer detail exists', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ToolLine } = await import('./ToolLine')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <ToolLine title="Search" subtitle="A very long status that no longer fits">
            Output
          </ToolLine>,
        ),
      )

      const title = host.querySelector<HTMLElement>('[data-slot="tool-line-title"]')!
      const subtitle = host.querySelector<HTMLElement>('[data-slot="tool-line-subtitle"]')!
      setBoxWidths(title, 120, 120)
      setBoxWidths(subtitle, 120, 280)

      const button = host.querySelector<HTMLButtonElement>('button')!
      await act(async () => button.focus())

      const tooltip = document.body.querySelector<HTMLElement>('[role="tooltip"]')!
      expect(tooltip.textContent).toBe('A very long status that no longer fits')
      expect(button.getAttribute('aria-describedby')).toBe(tooltip.id)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('does not create a redundant tooltip for fully visible text', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ToolLine } = await import('./ToolLine')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <ToolLine title="Search" subtitle="Done">
            Output
          </ToolLine>,
        ),
      )

      const title = host.querySelector<HTMLElement>('[data-slot="tool-line-title"]')!
      const subtitle = host.querySelector<HTMLElement>('[data-slot="tool-line-subtitle"]')!
      setBoxWidths(title, 120, 120)
      setBoxWidths(subtitle, 120, 120)

      const button = host.querySelector<HTMLButtonElement>('button')!
      await act(async () => button.focus())

      expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
      expect(button.getAttribute('aria-describedby')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
