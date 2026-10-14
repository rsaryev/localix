import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('scrolling breadcrumbs reveal the leaf on navigation and resize, preserving native gestures', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WorkbenchBreadcrumb } = await import('./workbench-breadcrumb')
  const originalObserver = globalThis.ResizeObserver
  let resize = () => {}
  let disconnected = false
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback
    }
    observe() {}
    unobserve() {}
    disconnect() {
      disconnected = true
    }
  } as unknown as typeof ResizeObserver
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const paint = async (key: string, scrollable = true) => {
    await React.act(async () =>
      root.render(
        <WorkbenchBreadcrumb aria-label="Session path" scrollable={scrollable} scrollToEndKey={key}>
          <li>Workspace</li>
          <li>Parent</li>
          <li aria-current="page">{key}</li>
        </WorkbenchBreadcrumb>,
      ),
    )
  }
  try {
    await paint('first')
    const list = host.querySelector('ol')!
    Object.defineProperties(list, {
      scrollWidth: { value: 1200, configurable: true },
      clientWidth: { value: 400, configurable: true },
      scrollHeight: { value: 28, configurable: true },
      clientHeight: { value: 28, configurable: true },
    })
    await paint('second')
    expect(list.scrollLeft).toBe(1200)
    list.scrollLeft = 100
    const wheel = new WheelEvent('wheel', { deltaY: 40, cancelable: true })
    list.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(list.scrollLeft).toBe(140)
    const native = new WheelEvent('wheel', { deltaX: 60, deltaY: 1, cancelable: true })
    list.dispatchEvent(native)
    expect(native.defaultPrevented).toBe(false)
    expect(list.scrollLeft).toBe(140)
    await paint('second')
    expect(list.scrollLeft).toBe(140) // Ordinary rerenders don't take scrolling away from the user.
    resize()
    expect(list.scrollLeft).toBe(1200)
    await paint('second', false)
    list.scrollLeft = 100
    const disabled = new WheelEvent('wheel', { deltaY: 40, cancelable: true })
    list.dispatchEvent(disabled)
    expect(disabled.defaultPrevented).toBe(false)
    expect(list.scrollLeft).toBe(100)
    expect(disconnected).toBe(true)
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
    globalThis.ResizeObserver = originalObserver
  }
})
