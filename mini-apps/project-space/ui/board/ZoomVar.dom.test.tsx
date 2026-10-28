import { afterAll, beforeAll, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('a renewed gesture or closing the board cancels pending idle zoom writes', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Canvas, CanvasProvider, useCanvasCamera } = await import('@localixai/kit/canvas')
  const { ZoomVar } = await import('./ZoomVar')
  const { CAMERA_REST_MS } = await import('@localixai/kit/canvas')
  const idle = new Map<number, IdleRequestCallback>()
  let sequence = 0
  const originalIdle = window.requestIdleCallback
  const originalCancel = window.cancelIdleCallback
  window.requestIdleCallback = (callback) => {
    const id = ++sequence
    idle.set(id, callback)
    return id
  }
  window.cancelIdleCallback = (id) => {
    idle.delete(id)
  }
  let camera: ReturnType<typeof useCanvasCamera> | undefined
  function Probe() {
    const target = React.useRef<HTMLDivElement>(null)
    const current = useCanvasCamera()
    React.useEffect(() => {
      camera = current
    })
    return (
      <div ref={target}>
        <Canvas label="Zoom lifecycle" nodes={[]} edges={[]} controls={false} />
        <ZoomVar target={target} />
      </div>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await React.act(async () =>
      root.render(
        <CanvasProvider initialWidth={800} initialHeight={600}>
          <Probe />
        </CanvasProvider>,
      ),
    )
    jest.useFakeTimers()
    await React.act(async () => camera!.set({ x: 0, y: 0, zoom: 0.7 }))
    await React.act(async () => jest.advanceTimersByTime(CAMERA_REST_MS))
    expect(idle.size).toBe(1)
    await React.act(async () => camera!.set({ x: 0, y: 0, zoom: 0.8 }))
    expect(idle.size).toBe(0)
    await React.act(async () => jest.advanceTimersByTime(CAMERA_REST_MS))
    expect(idle.size).toBe(1)
    await React.act(async () => root.unmount())
    expect(idle.size).toBe(0)
  } finally {
    jest.useRealTimers()
    await React.act(async () => root.unmount())
    if (originalIdle === undefined) Reflect.deleteProperty(window, 'requestIdleCallback')
    else window.requestIdleCallback = originalIdle
    if (originalCancel === undefined) Reflect.deleteProperty(window, 'cancelIdleCallback')
    else window.cancelIdleCallback = originalCancel
    host.remove()
  }
})
