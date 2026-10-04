import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { spaceApi } from '../api'
import type { CameraDirector } from './useCameraDirector'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('closing a board during its placement pause never moves or reports its camera later', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CanvasProvider } = await import('@localixai/kit/canvas')
  const { useCameraBridge } = await import('./useCameraBridge')
  const originalWait = spaceApi.cameraWait
  const originalReport = spaceApi.cameraReport
  let waits = 0
  let moves = 0
  let reports = 0
  spaceApi.cameraWait = async () => {
    waits++
    return { seq: 1, move: { kind: 'zoom', zoom: 1.5 } }
  }
  spaceApi.cameraReport = async () => {
    reports++
    return { ok: true }
  }
  const unexpectedMove = () => {
    throw new Error('Unexpected camera operation')
  }
  const director: CameraDirector = {
    size: () => ({ width: 800, height: 600 }),
    jump: async () => {
      moves++
      return { x: 0, y: 0, zoom: 1.5 }
    },
    frame: unexpectedMove,
    glide: unexpectedMove,
    back: () => false,
    forward: () => false,
    spotlight: unexpectedMove,
    history: { canBack: false, canForward: false, jumpedAt: 0 },
  }
  function Probe() {
    useCameraBridge('closing-board', director, () => undefined)
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await React.act(async () =>
      root.render(
        <CanvasProvider>
          <Probe />
        </CanvasProvider>,
      ),
    )
    expect(waits).toBe(1)
    await React.act(async () => root.unmount())
    // The old placement timer expired at 450ms and invoked jump on the detached board.
    await new Promise((resolve) => setTimeout(resolve, 480))
    expect(moves).toBe(0)
    expect(reports).toBe(0)
    expect(waits).toBe(1)
  } finally {
    await React.act(async () => root.unmount())
    spaceApi.cameraWait = originalWait
    spaceApi.cameraReport = originalReport
    host.remove()
  }
})
