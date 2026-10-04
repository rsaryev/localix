import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { forgetPreviewFrames, readPreviewFrame } from '../model/previewLastFrame'
import { usePreviewLastFrame } from './usePreviewLastFrame'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})
afterEach(forgetPreviewFrames)

const IMAGE = { data: 'AAA', mediaType: 'image/jpeg', width: 800, height: 600 }

function Harness({
  active = true,
  live = true,
  connected = true,
  capture,
}: {
  active?: boolean
  live?: boolean
  connected?: boolean
  capture: () => Promise<typeof IMAGE | null>
}) {
  const frame = usePreviewLastFrame({
    active,
    live,
    connected,
    url: 'http://localhost:4321',
    frameKey: 'http://localhost:4321|0|1',
    captureElement: capture,
    settleMs: 1,
  })
  return <span data-testid="frame">{frame ? 'ghost' : 'none'}</span>
}

/** Let the settle timer fire and its capture promise resolve inside React's act scope. */
async function settle(act: (fn: () => Promise<void>) => Promise<void>) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

test('photographs a live preview once it settles, and keeps the frame for a dead one', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let calls = 0
  const capture = async () => {
    calls += 1
    return IMAGE
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<Harness capture={capture} />))
    await settle(act)

    expect(calls).toBe(1)
    expect(container.textContent).toBe('ghost')
    expect(readPreviewFrame('http://localhost:4321')?.src).toBe('data:image/jpeg;base64,AAA')

    // The server dies: nothing new is photographed, and the frame we have survives so the
    // dormant pane has a page to show.
    await act(async () => root.render(<Harness live={false} capture={capture} />))
    await settle(act)

    expect(calls).toBe(1)
    expect(container.textContent).toBe('ghost')
  } finally {
    await act(async () => root.unmount())
  }
})

test('never photographs a preview with no probe, or one mounted out of sight', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let calls = 0
  const capture = async () => {
    calls += 1
    return IMAGE
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Harness connected={false} capture={capture} />))
    await settle(act)
    await act(async () => root.render(<Harness active={false} capture={capture} />))
    await settle(act)

    expect(calls).toBe(0)
  } finally {
    await act(async () => root.unmount())
  }
})

test('a capture that fails leaves the pane to its themed fallback, silently', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(<Harness capture={() => Promise.reject(new Error('probe went away'))} />),
    )
    await settle(act)

    expect(container.textContent).toBe('none')
    expect(readPreviewFrame('http://localhost:4321')).toBeNull()
  } finally {
    await act(async () => root.unmount())
  }
})
