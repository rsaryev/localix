import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/** The toolbar shows the zoom as a whole percent, and redraws only when that percent changes. */
test('the zoom label follows the rounded percent and nothing else', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useStoreApi } = await import('@xyflow/react')
  const { CanvasProvider } = await import('./primitives')
  const { CanvasControls } = await import('./CanvasControls')

  let store: ReturnType<typeof useStoreApi> | null = null
  function StoreProbe() {
    const api = useStoreApi()
    React.useEffect(() => {
      store = api
    }, [api])
    return null
  }
  let commits = 0
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(
      <CanvasProvider>
        <StoreProbe />
        <React.Profiler id="controls" onRender={() => commits++}>
          <CanvasControls interaction="edit" showHint={false} />
        </React.Profiler>
      </CanvasProvider>,
    )
  })
  const zoomTo = async (zoom: number) =>
    React.act(async () => {
      store?.setState({ transform: [0, 0, zoom] })
    })
  const label = () => host.querySelector('[aria-label^="Zoom "][aria-label$="reset to 100%"]')

  await zoomTo(1)
  expect(label()?.textContent).toBe('100%')
  const settled = commits

  await zoomTo(1.001)
  expect(label()?.textContent).toBe('100%')
  expect(commits).toBe(settled)

  await zoomTo(1.5)
  expect(label()?.textContent).toBe('150%')
  expect(label()?.getAttribute('aria-label')).toBe('Zoom 150%, reset to 100%')

  await React.act(async () => root.unmount())
  host.remove()
})
