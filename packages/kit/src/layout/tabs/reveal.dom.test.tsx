import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '../../testing/dom'
import { TabStrip } from './tabs'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

/** A 300px viewport over five 200px tabs (1000px of content, 700px of scroll room). */
const TAB_WIDTH = 200
const VIEWPORT = 300
const CONTENT = 1000
const MAX_SCROLL = CONTENT - VIEWPORT
const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase() }))

const restores: Array<() => void> = []
afterEach(() => {
  while (restores.length) restores.pop()?.()
})

/**
 * Swap a DOM method for the duration of a test, returning its restore.
 *
 * happy-dom defines `getBoundingClientRect` / `scrollIntoView` on `Element.prototype`,
 * so there is no own descriptor to save on `HTMLElement.prototype`: we shadow with an
 * own property and delete it again. Reading through this index-signature view also
 * keeps the capture off the typed class method (`unbound-method`).
 */
// Resolved lazily: bun evaluates this module before `registerDom()` runs, so there
// is no `HTMLElement` at module scope yet.
const elementProto = () => HTMLElement.prototype as unknown as Record<string, unknown>

function stubElementMethod(name: string, impl: (this: HTMLElement) => unknown): () => void {
  const proto = elementProto()
  const hadOwn = Object.prototype.hasOwnProperty.call(proto, name)
  const previous = proto[name]
  proto[name] = impl
  return () => {
    if (hadOwn) proto[name] = previous
    else delete proto[name]
  }
}

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function stubResizeObserver() {
  const original = globalThis.ResizeObserver
  globalThis.ResizeObserver = NoopResizeObserver
  restores.push(() => {
    globalThis.ResizeObserver = original
  })
}

/**
 * Give the tablist the geometry of an overflowing strip and lay the tabs out at
 * 200px each. `getBoundingClientRect` is derived from the LIVE `scrollLeft`, so the
 * numbers the component reads back stay self-consistent after it scrolls.
 */
function stubStripGeometry(list: HTMLElement) {
  let scrollLeft = 0
  const define = (el: HTMLElement, prop: string, get: () => number) => {
    const original = Object.getOwnPropertyDescriptor(el, prop)
    Object.defineProperty(el, prop, { configurable: true, get })
    restores.push(() => {
      if (original) Object.defineProperty(el, prop, original)
      else delete (el as unknown as Record<string, unknown>)[prop]
    })
  }
  define(list, 'clientWidth', () => VIEWPORT)
  define(list, 'scrollWidth', () => CONTENT)
  define(list, 'clientHeight', () => 32)
  define(list, 'scrollHeight', () => 32)
  Object.defineProperty(list, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (next: number) => {
      scrollLeft = next
    },
  })

  const callThrough = elementProto().getBoundingClientRect as (this: HTMLElement) => DOMRect
  restores.push(
    stubElementMethod('getBoundingClientRect', function (this: HTMLElement) {
      const rect = (left: number, width: number) =>
        ({
          left,
          width,
          right: left + width,
          top: 0,
          bottom: 32,
          height: 32,
          x: left,
          y: 0,
        }) as DOMRect
      if (this === list) return rect(0, VIEWPORT)
      const id = this.getAttribute('data-tabstrip-id')
      if (id) return rect(items.findIndex((i) => i.id === id) * TAB_WIDTH - scrollLeft, TAB_WIDTH)
      return callThrough.call(this)
    }),
  )

  return { current: () => scrollLeft }
}

async function renderStrip(activeId: string) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      // `edgeFade` on purpose: it reserves 24px at each edge, so revealing the first
      // or last tab AIMS PAST the boundary — only the clamp lands it exactly on it.
      <TabStrip
        aria-label="Editor tabs"
        items={items}
        activeId={activeId}
        onChange={() => {}}
        edgeFade
      />,
    )
  })
  const list = host.querySelector<HTMLElement>('[role="tablist"]')!
  return {
    host,
    list,
    setActive: (id: string) =>
      act(async () => {
        root.render(
          <TabStrip
            aria-label="Editor tabs"
            items={items}
            activeId={id}
            onChange={() => {}}
            edgeFade
          />,
        )
      }),
    unmount: () => act(async () => root.unmount()),
  }
}

describe('revealing the active tab', () => {
  test('lands exactly on the last tab instead of leaving it clipped', async () => {
    stubResizeObserver()
    const strip = await renderStrip('a')
    const scroll = stubStripGeometry(strip.list)
    try {
      await strip.setActive('e')
      expect(scroll.current()).toBe(MAX_SCROLL)
      // …and back to the very start for the first tab.
      await strip.setActive('a')
      expect(scroll.current()).toBe(0)
    } finally {
      await strip.unmount()
      strip.host.remove()
    }
  })

  // `scrollIntoView` walks EVERY scrollable ancestor, so it could scroll the page
  // vertically just to show a tab. The reveal must touch one property, on one node.
  test('never calls scrollIntoView, so no ancestor (or the page) is scrolled', async () => {
    stubResizeObserver()
    const calls: Element[] = []
    restores.push(
      stubElementMethod('scrollIntoView', function (this: HTMLElement) {
        calls.push(this)
      }),
    )

    const strip = await renderStrip('a')
    stubStripGeometry(strip.list)
    try {
      await strip.setActive('e')
      await strip.setActive('c')
      expect(calls).toEqual([])
    } finally {
      await strip.unmount()
      strip.host.remove()
    }
  })
})

function dispatchWheel(el: HTMLElement, deltaY: number, deltaX = 0) {
  const event = new globalThis.WheelEvent('wheel', {
    deltaX,
    deltaY,
    cancelable: true,
    bubbles: true,
  })
  el.dispatchEvent(event)
  return event
}

describe('wheeling over the strip', () => {
  test('consumes a vertical wheel it can act on, and only then preventDefaults', async () => {
    stubResizeObserver()
    const strip = await renderStrip('a')
    const scroll = stubStripGeometry(strip.list)
    try {
      const consumed = dispatchWheel(strip.list, 120)
      expect(consumed.defaultPrevented).toBe(true)
      expect(scroll.current()).toBe(120)
    } finally {
      await strip.unmount()
      strip.host.remove()
    }
  })

  test('leaves a horizontal trackpad swipe to the browser, inertia included', async () => {
    stubResizeObserver()
    const strip = await renderStrip('a')
    const scroll = stubStripGeometry(strip.list)
    try {
      const swipe = dispatchWheel(strip.list, 2, 80)
      expect(swipe.defaultPrevented).toBe(false)
      expect(scroll.current()).toBe(0)
    } finally {
      await strip.unmount()
      strip.host.remove()
    }
  })

  test('hands the wheel back to the page once pinned at the end', async () => {
    stubResizeObserver()
    const strip = await renderStrip('a')
    const scroll = stubStripGeometry(strip.list)
    try {
      strip.list.scrollLeft = MAX_SCROLL
      const atEnd = dispatchWheel(strip.list, 120)
      expect(atEnd.defaultPrevented).toBe(false)
      expect(scroll.current()).toBe(MAX_SCROLL)
    } finally {
      await strip.unmount()
      strip.host.remove()
    }
  })
})
