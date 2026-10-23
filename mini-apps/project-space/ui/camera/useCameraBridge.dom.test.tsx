import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { miniAppRealtime } from '@localixai/mini-app-sdk/ui/runtime'
import type { CameraMove, CameraReport } from '../../shared/camera'
import { CAMERA_SUBSCRIBE } from '../../shared/resource'
import { spaceApi } from '../api'
import type { CameraBridgeOptions } from './useCameraBridge'
import type { CameraDirector } from './useCameraDirector'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

let push: (json: string) => void = () => {}
const requests: Record<string, unknown>[] = []
const reports: CameraReport[] = []
const restores: Array<() => void> = []
beforeEach(() => {
  requests.length = 0
  reports.length = 0
  const spies = [
    spyOn(miniAppRealtime, 'request').mockImplementation(async (payload) => {
      requests.push(payload)
      return { subscribed: true } as never
    }),
    spyOn(miniAppRealtime, 'onFrame').mockImplementation((_tag, handler) => {
      push = handler
      return () => {}
    }),
    spyOn(miniAppRealtime, 'onReconnect').mockImplementation(() => () => {}),
    spyOn(miniAppRealtime, 'onDisconnect').mockImplementation(() => () => {}),
  ]
  const originalReport = spaceApi.cameraReport
  spaceApi.cameraReport = async (_sessionId, report) => {
    reports.push(report)
    return { ok: true }
  }
  restores.push(() => {
    for (const spy of spies) spy.mockRestore()
    spaceApi.cameraReport = originalReport
  })
})
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function directorStub(moves: CameraMove[]): CameraDirector {
  const unexpected = () => {
    throw new Error('Unexpected camera operation')
  }
  return {
    size: () => ({ width: 800, height: 600 }),
    jump: async () => {
      moves.push({ kind: 'zoom', zoom: 1.5 })
      return { x: 0, y: 0, zoom: 1.5 }
    },
    frame: unexpected,
    glide: unexpected,
    back: () => false,
    forward: () => false,
    spotlight: unexpected,
    history: { canBack: false, canForward: false, jumpedAt: 0 },
  }
}

async function mountBridge(
  sessionId: string,
  director: CameraDirector,
  options: CameraBridgeOptions,
) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CanvasProvider } = await import('@localixai/kit/canvas')
  const { useCameraBridge } = await import('./useCameraBridge')
  function Probe() {
    useCameraBridge(sessionId, director, () => undefined, options)
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () =>
    root.render(
      <CanvasProvider>
        <Probe />
      </CanvasProvider>,
    ),
  )
  return {
    act: React.act,
    unmount: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

const frame = (sessionId: string, seq: number) =>
  JSON.stringify({ sessionId, camera: { seq, move: { kind: 'zoom', zoom: 1.5 } } })

test('a pushed move is taken and reported once, even when the stream re-sends it', async () => {
  const moves: CameraMove[] = []
  const board = await mountBridge('pushed-board', directorStub(moves), {
    live: true,
    pause: async () => {},
    now: () => 0,
  })
  try {
    expect(requests).toEqual([{ t: CAMERA_SUBSCRIBE, sessionId: 'pushed-board' }])
    await board.act(async () => {
      push(frame('pushed-board', 1))
      push(frame('pushed-board', 1)) // the fresh last move, re-sent when a stream restarts
      push(frame('another-board', 2))
      await flush()
    })
    expect(moves).toHaveLength(1)
    expect(reports.map((report) => report.seq)).toEqual([1])
  } finally {
    await board.unmount()
  }
})

test('closing a board during its placement pause never moves or reports its camera later', async () => {
  const moves: CameraMove[] = []
  let settle!: () => void
  const board = await mountBridge('closing-board', directorStub(moves), {
    live: true,
    pause: () =>
      new Promise((resolve) => {
        settle = resolve
      }),
    now: () => 0,
  })
  await board.act(async () => {
    push(frame('closing-board', 1))
    await flush()
  })
  await board.unmount()
  settle()
  await flush()
  expect(moves).toEqual([])
  expect(reports).toEqual([])
})

test('a board whose backend does not stream subscribes to nothing', async () => {
  const board = await mountBridge('offline-board', directorStub([]), { live: false })
  try {
    expect(requests).toEqual([])
  } finally {
    await board.unmount()
  }
})
