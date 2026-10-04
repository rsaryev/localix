import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { CanvasProvider } from '@localixai/kit/canvas'
import { registerDom } from '@localixai/kit/testing'
import { emptySpace } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'
import { PenLayer } from './PenLayer'

let teardown: () => Promise<void>
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  environment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  delete environment.IS_REACT_ACT_ENVIRONMENT
})

test('pen saves only a completed stroke, cancels drafts and restores board keyboard focus', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  const writes: (readonly SpaceOp[])[] = []
  const selected: string[][] = []
  const keys: string[] = []
  let finished = 0,
    cancelled = 0
  try {
    await act(async () =>
      root.render(
        <CanvasProvider>
          <div>
            <div className="localix-canvas" tabIndex={0} />
            <PenLayer
              type="pen"
              space={emptySpace()}
              toolProps={{ color: 'purple' }}
              commit={(ops) => writes.push(ops)}
              select={(ids) => selected.push([...ids])}
              finish={() => finished++}
              cancel={() => cancelled++}
              onBoardKey={(event) => {
                keys.push(event.key)
                return true
              }}
            />
          </div>
        </CanvasProvider>,
      ),
    )
    const layer = host.querySelector<HTMLElement>('[role="application"]')!
    let captured = false
    Object.assign(layer, {
      setPointerCapture: () => {
        captured = true
      },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => {
        captured = false
      },
    })
    const pointer = async (type: string, x: number, y: number) =>
      act(async () => {
        layer.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: x,
            clientY: y,
          }),
        )
      })
    expect(document.activeElement).toBe(layer)
    await act(async () => {
      layer.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }))
    })
    expect(keys).toEqual(['q'])
    await pointer('pointerdown', 100, 100)
    await pointer('pointermove', 120, 130)
    expect(writes).toHaveLength(0)
    await pointer('pointerup', 140, 120)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toHaveLength(1)
    expect(writes[0]![0]).toMatchObject({
      op: 'create',
      type: 'pen',
      x: 95,
      y: 95,
      w: 50,
      h: 40,
      props: { color: 'purple' },
    })
    expect(selected[0]).toEqual([(writes[0]![0] as { id: string }).id])
    expect(finished).toBe(1)
    expect(document.activeElement).toBe(host.querySelector('.localix-canvas'))
    await pointer('pointerdown', 200, 200)
    await pointer('pointermove', 240, 230)
    await act(async () => {
      layer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await pointer('pointerup', 240, 230)
    expect(writes).toHaveLength(1)
    expect(cancelled).toBe(1)
    await pointer('pointerdown', 300, 300)
    await pointer('pointercancel', 310, 310)
    await pointer('pointerup', 310, 310)
    expect(writes).toHaveLength(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
