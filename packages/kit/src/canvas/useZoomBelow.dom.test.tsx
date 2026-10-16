import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A card's level of detail changes once the camera RESTS past the threshold, not the frame a
 * flight crosses it: every card on the board swapping summary for detail in one frame stalled
 * the flight there.
 */
test('the level of detail follows the zoom only once the camera rests', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useStoreApi } = await import('@xyflow/react')
  const { CanvasProvider } = await import('./primitives')
  const { useZoomBelow } = await import('./useCanvasCamera')

  const seen: boolean[] = []
  let store: ReturnType<typeof useStoreApi> | null = null
  function Probe() {
    store = useStoreApi()
    seen.push(useZoomBelow(0.5))
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(
      <CanvasProvider>
        <Probe />
      </CanvasProvider>,
    )
  })
  expect(seen.at(-1)).toBe(false)

  // A flight passing through: far past the threshold and back, faster than the camera rests.
  const zoomTo = async (zoom: number) =>
    React.act(async () => {
      store?.setState({ transform: [0, 0, zoom] })
    })
  await zoomTo(0.3)
  // Mid-flight, past the threshold: the old answer stands (an instant answer flipped here).
  expect(seen.at(-1)).toBe(false)
  await zoomTo(0.2)
  await zoomTo(0.9)
  await React.act(async () => wait(220))
  expect(seen.at(-1)).toBe(false)

  // A camera that comes to rest past it: the detail changes, once.
  await zoomTo(0.3)
  expect(seen.at(-1)).toBe(false)
  await React.act(async () => wait(220))
  expect(seen.at(-1)).toBe(true)

  await React.act(async () => root.unmount())
  host.remove()
})
