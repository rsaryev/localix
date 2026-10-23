import { afterAll, beforeAll, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ElementViewProps } from './contract'
import { contentOperation } from '../action-target'
import { applyOps } from '../../shared/ops/apply'
import { emptySpace } from '../../shared/format/document'
import { spaceTypes } from '../../shared/types'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const elementProps: ElementViewProps = {
  id: 'fragment',
  props: {},
  width: 240,
  height: 100,
  selected: false,
  editing: false,
  missing: false,
  sessionId: 'board-chat',
  stamp: 0,
  commit: () => {},
  resize: () => {},
  stopEditing: () => {},
}

test('imported answer forms keep their renderer, controls and editable source on the board', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { drawingViews } = await import('./drawing')
  const View = drawingViews.find((view) => view.type === 'text')!.View
  const tree = '```tree\nproject/\n├── README.md\n└── src/\n    └── app.ts # entry\n```'
  const source = [
    tree,
    '> [!STEPS]\n1. **Prepare**\n   *Today*\n   Make a backup.',
    '> [!STATS]\n- **3×** faster\n- **40%** smaller',
    '> [!PROS]\n- Simple\n\n> [!CONS]\n- Limited',
    '> [!TIP] Backup\n> Save your work.',
    '> Keep it simple.\n> — Author',
    '- [ ] Verify the release\n\n  Read the checklist.\n\n  - [ ] Run the smoke test',
    '> [!TABS]\n#### **macOS**\nUse brew.\n#### *Linux*\nUse apt.',
  ].join('\n\n')
  const operation = contentOperation({ kind: 'markdown', block: 'other', markdown: source })
  const { space } = applyOps(emptySpace(), [{ ...operation, id: 'fragment' }], {
    registry: spaceTypes,
  })
  const props = spaceTypes.read('text', space.elements.fragment!.props)
  expect(props.status).toBe('ok')
  if (props.status !== 'ok') throw new Error('Imported Markdown was rejected')
  let text = source
  let edits = 0
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = () =>
    root.render(
      <div onDoubleClick={() => edits++}>
        <View
          {...elementProps}
          props={{ ...props.props, text }}
          commit={(next) => {
            text = String(next.text)
            render()
          }}
        />
      </div>,
    )
  try {
    await act(async () => render())
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(4)
    for (const selector of [
      '.lx-steps',
      '.lx-stats',
      '.lx-verdicts',
      '.lx-callout',
      '.lx-quote-source',
    ])
      expect(host.querySelector(selector), selector).not.toBeNull()
    expect(host.textContent).not.toContain('[!')
    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    expect(Array.from(tabs, (tab) => tab.textContent)).toEqual(['macOS', 'Linux'])
    await act(async () => {
      tabs[1]!.click()
      tabs[1]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.textContent?.trim()).toBe(
      'Use apt.',
    )
    expect(edits).toBe(0)
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]!.disabled).toBe(false)
    await act(async () => boxes[0]!.click())
    expect(text).toContain('- [x] Verify the release')
    expect(text).toContain('- [ ] Run the smoke test')
    expect(text).toContain(tree)
    await act(async () =>
      host
        .querySelector('.lx-step-body')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    )
    expect(edits).toBe(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('rendered height follows content and width, and editing cancels a pending fit', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { drawingViews } = await import('./drawing')
  const View = drawingViews.find((view) => view.type === 'text')!.View
  const OriginalObserver = globalThis.ResizeObserver
  let observed: Element | undefined
  let notify: (() => void) | undefined
  let disconnected = false
  class MeasureObserver {
    constructor(callback: ResizeObserverCallback) {
      notify = () => callback([], this as unknown as ResizeObserver)
    }
    observe(node: Element) {
      observed = node
    }
    unobserve() {}
    disconnect() {
      disconnected = true
    }
  }
  globalThis.ResizeObserver = MeasureObserver as unknown as typeof ResizeObserver
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const sizes: { w: number; h: number }[] = []
  const render = (width: number, height: number, editing = false) =>
    root.render(
      <View
        {...elementProps}
        props={{ text: '> [!STEPS]\n1. **Prepare**\n   Make a backup.', size: 'md' }}
        width={width}
        height={height}
        editing={editing}
        resize={(size) => sizes.push(size)}
      />,
    )
  // Fake timers: the fit's settle delay is advanced past, not slept through.
  jest.useFakeTimers()
  const settle = async () => {
    jest.advanceTimersByTime(280)
  }
  try {
    await act(async () => render(240, 100))
    expect(observed).toBeDefined()
    let measuredHeight = 420
    Object.defineProperty(observed!, 'offsetHeight', { get: () => measuredHeight })
    await act(async () => {
      notify!()
      await settle()
    })
    expect(sizes).toEqual([{ w: 240, h: 420 }])
    await act(async () => render(160, 420))
    measuredHeight = 580
    await act(async () => {
      notify!()
      await settle()
    })
    expect(sizes.at(-1)).toEqual({ w: 160, h: 580 })
    await act(async () => render(160, 580))
    await act(async () => {
      notify!()
      await settle()
    })
    expect(sizes).toHaveLength(2)
    measuredHeight = 620
    notify!()
    await act(async () => render(160, 580, true))
    await act(async () => settle())
    expect(disconnected).toBe(true)
    expect(sizes).toHaveLength(2)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    globalThis.ResizeObserver = OriginalObserver
    jest.useRealTimers()
  }
})
