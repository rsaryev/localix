import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('small pointer movement stays a click at every zoom; a deliberate drag moves the node', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Canvas } = await import('./Canvas')
  const { CanvasProvider } = await import('./primitives')
  for (const zoom of [0.4, 1, 2]) {
    let starts = 0
    let clicks = 0
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const mouse = (target: EventTarget, type: string, x: number, buttons = 1) => {
      target.dispatchEvent(
        new MouseEvent(type, {
          clientX: x,
          clientY: 100,
          button: 0,
          buttons,
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      )
    }
    try {
      await act(async () =>
        root.render(
          <CanvasProvider initialWidth={800} initialHeight={600}>
            <Canvas
              label="Drag tolerance"
              interaction="edit"
              controls={false}
              defaultViewport={{ x: 0, y: 0, zoom }}
              nodes={[
                {
                  id: 'a',
                  position: { x: 100, y: 100 },
                  data: { label: 'Card' },
                  measured: { width: 160, height: 100 },
                  width: 160,
                  height: 100,
                  selected: true,
                },
              ]}
              edges={[]}
              onNodeDragStart={() => starts++}
              onNodeClick={() => clicks++}
            />
          </CanvasProvider>,
        ),
      )
      const node = host.querySelector<HTMLElement>('.react-flow__node')!
      await act(async () => {
        mouse(node, 'mousedown', 100)
        mouse(window, 'mousemove', 103)
        mouse(window, 'mouseup', 103, 0)
        mouse(node, 'click', 103, 0)
      })
      expect(starts).toBe(0)
      expect(clicks).toBe(1)
      await act(async () => {
        mouse(node, 'mousedown', 100)
        mouse(window, 'mousemove', 110)
        mouse(window, 'mouseup', 110, 0)
        mouse(node, 'click', 110, 0)
      })
      expect(starts).toBe(1)
      expect(clicks).toBe(1)
      // D3 releases the click suppressor on the next task after a real drag.
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  }
})
