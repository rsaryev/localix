import { afterAll, beforeAll, expect, test } from 'bun:test'
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

test('mini app actions receive the picture and owning chat, and are also offered in the viewer', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WorkItemSessionProvider } = await import('@localixai/mini-app-sdk/ui/work-item-session')
  const { bindMiniAppUiTestDoubles } = await import('@localixai/mini-app-sdk/ui/testing')
  const { registerAction, removeActionsOf } = await import('@/shared/contrib/actions')
  const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
  const { MermaidDiagram } = await import('./MermaidDiagram')
  const source = 'pie\ntitle Example\n"A": 10'
  const svg = '<svg viewBox="0 0 500 300"><text>Example</text></svg>'
  const received: unknown[] = []
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const unbind = bindMiniAppUiTestDoubles()
  setEnabledMiniAppNames(new Set(['picture-fixture']))
  registerAction({
    id: 'picture-fixture:save',
    miniAppName: 'picture-fixture',
    label: 'Save picture',
    Icon: () => null,
    when: ({ target }) => target.kind === 'visualization',
    run: async (picture) => {
      received.push(picture)
      await pending
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <WorkItemSessionProvider sessionId="origin-chat">
          <MermaidDiagram source={source} renderer={{ peek: () => svg, render: async () => svg }} />
        </WorkItemSessionProvider>,
      ),
    )
    const save = host.querySelector<HTMLButtonElement>('button[aria-label="Save picture"]')!
    act(() => {
      save.click()
      save.click()
    })
    expect(received).toEqual([
      {
        sessionId: 'origin-chat',
        surface: 'content',
        target: {
          kind: 'visualization',
          title: 'Example',
          format: 'mermaid',
          source,
          svg,
          width: 500,
          height: 300,
        },
      },
    ])
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="Save picture"]')!.disabled,
    ).toBe(true)
    await act(async () => {
      finish()
      await pending
    })
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button.lx-diagram-canvas')!.click(),
    )
    expect(
      document.querySelector('[role="dialog"] button[aria-label="Save picture"]'),
    ).not.toBeNull()
  } finally {
    finish()
    await act(async () => root.unmount())
    host.remove()
    removeActionsOf('picture-fixture')
    setEnabledMiniAppNames(null)
    unbind()
  }
})

test('opens the rendered diagram without rerendering it and returns focus when closed', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MermaidDiagram } = await import('./MermaidDiagram')
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 120"><text>Long chain</text></svg>'
  let renders = 0
  const renderer = {
    peek: () => svg,
    render: async () => {
      renders += 1
      return svg
    },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(<MermaidDiagram source="flowchart LR; A-->B" renderer={renderer} />),
    )
    const trigger = host.querySelector<HTMLButtonElement>('button.lx-diagram-canvas')!
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    act(() => {
      trigger.click()
    })
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.querySelector('.react-flow__background')).toBeNull()
    expect(dialog.textContent).not.toContain('Drag to pan')
    expect(dialog.textContent).toContain('Long chain')
    expect(dialog.querySelector('button[aria-label="Fit everything"]')).not.toBeNull()
    expect(dialog.querySelector('button[aria-label="Zoom in"]')).not.toBeNull()
    expect(renders).toBe(0)
    await act(async () =>
      dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(),
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    // Reopening must also show the diagram in this render.
    act(() => {
      trigger.click()
    })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!
        .click(),
    )
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Show source"]')!.click(),
    )
    expect(host.querySelector('pre')?.textContent).toContain('flowchart LR; A-->B')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('a changed source never exports a picture from the previous source while drawing', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MermaidDiagram } = await import('./MermaidDiagram')
  let finish!: (svg: string) => void
  const pending = new Promise<string>((resolve) => {
    finish = resolve
  })
  const renderer = {
    peek: (source: string) =>
      source === 'old' ? '<svg viewBox="0 0 100 100"><text>Old</text></svg>' : undefined,
    render: async () => pending,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<MermaidDiagram source="old" renderer={renderer} />))
    expect(host.querySelector('svg')?.textContent).toBe('Old')
    await act(async () => root.render(<MermaidDiagram source="new" renderer={renderer} />))
    expect(host.querySelector('.lx-diagram-canvas')).toBeNull()
    expect(host.querySelector('[aria-label="Drawing diagram"]')).not.toBeNull()
    await act(async () => {
      finish('<svg viewBox="0 0 100 100"><text>New</text></svg>')
      await pending
    })
    expect(host.querySelector('svg')?.textContent).toBe('New')
  } finally {
    finish('')
    await act(async () => root.unmount())
    host.remove()
  }
})

test('replacing or unmounting a diagram releases its queued renderer request', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MermaidDiagram } = await import('./MermaidDiagram')
  const signals: AbortSignal[] = []
  const renderer = {
    peek: () => undefined,
    render: (_source: string, _look: unknown, signal?: AbortSignal) => {
      if (!signal) throw new Error('Diagram did not provide a render lifetime')
      signals.push(signal)
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
      })
    },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<MermaidDiagram source="first" renderer={renderer} />))
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)
    await act(async () => root.render(<MermaidDiagram source="second" renderer={renderer} />))
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    await act(async () => root.unmount())
    expect(signals[1]?.aborted).toBe(true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
