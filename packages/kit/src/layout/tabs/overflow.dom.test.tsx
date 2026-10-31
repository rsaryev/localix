import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act, useRef } from 'react'
import { registerDom } from '../../testing/dom'
import { useTabOverflow } from './overflow'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

function Strip({ onResize }: { onResize: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useTabOverflow(ref, [], true, onResize)
  return <div ref={ref} />
}

test('a resize calls the latest onResize without observing the strip again', async () => {
  const { createRoot } = await import('react-dom/client')
  const observers: ResizeObserverCallback[] = []
  const Original = globalThis.ResizeObserver
  globalThis.ResizeObserver = class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      observers.push(callback)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const root = createRoot(document.createElement('div'))
  const calls: string[] = []
  try {
    await act(async () => root.render(<Strip onResize={() => calls.push('first')} />))
    await act(async () => root.render(<Strip onResize={() => calls.push('second')} />))
    await act(async () => observers[0]?.([], {} as ResizeObserver))
    await act(async () => window.dispatchEvent(new Event('resize')))

    expect(observers).toHaveLength(1)
    expect(calls).toEqual(['second', 'second'])
  } finally {
    await act(async () => root.unmount())
    globalThis.ResizeObserver = Original
  }
})
