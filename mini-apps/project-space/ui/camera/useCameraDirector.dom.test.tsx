import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('a new flight, a hand gesture and unmount each release frames and timers immediately', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CanvasProvider } = await import('@localixai/kit/canvas')
  const { useCameraDirector } = await import('./useCameraDirector')
  let director: ReturnType<typeof useCameraDirector> | undefined
  function Probe() {
    const board = React.useRef<HTMLDivElement>(null)
    const value = useCameraDirector(board)
    // The test reads the latest director once the commit is done, not while rendering.
    React.useEffect(() => {
      director = value
    })
    return (
      <div ref={board}>
        <div className="react-flow__node" data-id="note" />
      </div>
    )
  }
  const frames = new Map<number, FrameRequestCallback>()
  const timers = new Set<number>()
  // `window` also intersects Bun's process globals in this compile project. This test owns
  // happy-dom's browser timers, whose handles follow Window's numeric contract.
  const browserWindow: Window = window
  let frameSequence = 0
  const originalFrame = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const originalTimeout = browserWindow.setTimeout.bind(browserWindow)
  const originalClear = browserWindow.clearTimeout.bind(browserWindow)
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++frameSequence
    frames.set(id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id)
  }
  browserWindow.setTimeout = (callback, delay) => {
    const id = originalTimeout(callback, delay)
    timers.add(id)
    return id
  }
  browserWindow.clearTimeout = (id) => {
    if (id !== undefined) timers.delete(id)
    originalClear(id)
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
    const first = director!.glide({ x: -800, y: -600, zoom: 0.5 })
    expect(frames.size).toBe(1)
    const second = director!.glide({ x: -200, y: -100, zoom: 0.8 })
    await first
    expect(frames.size).toBe(1)
    expect(timers.size).toBe(1)
    host.firstElementChild!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await second
    expect(frames.size).toBe(0)
    expect(timers.size).toBe(0)

    const last = director!.glide({ x: -800, y: -600, zoom: 0.5 })
    director!.spotlight(['note'])
    director!.spotlight(['note'])
    expect(timers.size).toBe(2)
    await React.act(async () => root.unmount())
    await last
    expect(frames.size).toBe(0)
    expect(timers.size).toBe(0)
  } finally {
    await React.act(async () => root.unmount())
    for (const id of timers) originalClear(id)
    globalThis.requestAnimationFrame = originalFrame
    globalThis.cancelAnimationFrame = originalCancel
    browserWindow.setTimeout = originalTimeout
    browserWindow.clearTimeout = originalClear
    host.remove()
  }
})
