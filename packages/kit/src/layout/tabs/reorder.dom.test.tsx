import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '../../testing/dom'
import { useTabReorder } from './reorder'
import { setNativeWindowDragImage } from '@localixai/mini-app-sdk/ui/message-binding-drag'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

async function mountReorder(nativePreview = false) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const ended: { id: string; event: globalThis.DragEvent | null; cancelled: boolean }[] = []
  const reordered: { from: string; to: string | null }[] = []
  function Harness() {
    const drag = useTabReorder({
      ids: ['a', 'b'],
      onReorder: (from, to) => reordered.push({ from, to }),
      onItemDragStart: nativePreview
        ? (_id, event) => setNativeWindowDragImage(event.dataTransfer)
        : undefined,
      onItemDragEnd: (id, event, cancelled) => ended.push({ id, event, cancelled }),
    })
    return (
      <div>
        <div {...drag.tabProps('a')}>A</div>
        <div {...drag.tabProps('b')}>B</div>
      </div>
    )
  }
  await act(async () => {
    root.render(<Harness />)
  })
  const tab = host.firstElementChild!.firstElementChild!
  const targetTab = host.firstElementChild!.lastElementChild!
  targetTab.getBoundingClientRect = () => ({ left: 100, width: 100 }) as DOMRect
  const payload = new Map<string, string>([
    ['text/plain', 'A'],
    ['text/uri-list', 'https://example.com/'],
    ['text/html', '<a href="https://example.com/">A</a>'],
  ])
  const images: HTMLElement[] = []
  const transfer = {
    dropEffect: 'none',
    effectAllowed: 'move',
    clearData() {
      payload.clear()
    },
    setData(key: string, value: string) {
      payload.set(key, value)
    },
    setDragImage(image: HTMLElement) {
      images.push(image)
    },
  }
  const dispatch = async (type: string, target: EventTarget = tab, clientX = 0) => {
    const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    Object.defineProperty(event, 'clientX', { value: clientX })
    await act(async () => {
      target.dispatchEvent(event)
    })
    return event
  }
  return {
    ended,
    images,
    tab,
    reordered,
    targetTab,
    transfer,
    payload,
    dispatch,
    dispose: async () => {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
}

test('dragend reports the source id and native event once', async () => {
  const view = await mountReorder()
  try {
    await view.dispatch('dragstart')
    const event = await view.dispatch('dragend')
    expect(view.ended).toEqual([{ id: 'a', event, cancelled: false }])
  } finally {
    await view.dispose()
  }
})

test('an internal tab drag exposes no text, URL, or HTML that Finder can turn into a file', async () => {
  const view = await mountReorder()
  try {
    await view.dispatch('dragstart')
    expect([...view.payload]).toEqual([['application/x-localix-tab', 'a']])
    expect(view.transfer.effectAllowed).toBe('move')
  } finally {
    await view.dispose()
  }
})

test('Finder focus before dragend preserves the source even when WebKit reports copy', async () => {
  const view = await mountReorder()
  try {
    await view.dispatch('dragstart')
    await act(async () => window.dispatchEvent(new Event('blur')))
    expect(view.ended).toEqual([])
    view.transfer.dropEffect = 'copy'
    const event = await view.dispatch('dragend')
    expect(view.ended).toEqual([{ id: 'a', event, cancelled: false }])
  } finally {
    await view.dispose()
  }
})

test('Escape suppresses outside-window tearout', async () => {
  const view = await mountReorder()
  try {
    await view.dispatch('dragstart')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await view.dispatch('dragend')
    expect(view.ended.length).toBe(1)
    expect(view.ended[0]?.cancelled).toBe(true)
  } finally {
    await view.dispose()
  }
})

test('a cross-surface DOM drop is accepted even when WebKit reports dropEffect none', async () => {
  const view = await mountReorder()
  try {
    await view.dispatch('dragstart')
    await view.dispatch('drop', document.body)
    await view.dispatch('dragend')
    expect(view.ended[0]?.cancelled).toBe(true)
  } finally {
    await view.dispose()
  }
})

test('the target midpoint chooses before or after a tab, including the trailing slot', async () => {
  const view = await mountReorder()
  try {
    await view.dispatch('dragstart')
    await view.dispatch('drop', view.targetTab, 120)
    expect(view.reordered).toEqual([{ from: 'a', to: 'b' }])
    await view.dispatch('dragstart')
    await view.dispatch('drop', view.targetTab, 180)
    expect(view.reordered[1]).toEqual({ from: 'a', to: null })
    await view.dispatch('dragend')
    expect(view.ended).toHaveLength(2)
  } finally {
    await view.dispose()
  }
})

test('a foreign strip drop remains available to the host instead of clearing its payload', async () => {
  const view = await mountReorder()
  try {
    const event = await view.dispatch('drop', view.targetTab)
    expect(event.defaultPrevented).toBe(false)
    expect(view.reordered).toEqual([])
    expect(view.ended).toEqual([])
  } finally {
    await view.dispose()
  }
})

test('a native window remains the only image after the strip finishes arming its drag', async () => {
  const view = await mountReorder(true)
  view.tab.getBoundingClientRect = () => ({ left: 0, top: 0, width: 180, height: 28 }) as DOMRect
  try {
    await view.dispatch('dragstart')
    expect(view.images.map((image) => image.tagName)).toEqual(['DIV', 'CANVAS'])
    await view.dispatch('dragend')
  } finally {
    await view.dispose()
  }
})
