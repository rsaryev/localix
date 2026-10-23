import { afterAll, beforeAll, expect, test } from 'bun:test'
import { z } from 'zod'
import { registerDom } from '@localixai/kit/testing/dom'
import { bindMiniAppUiTransport } from './transport'
import { usePolledSnapshot, type PolledSnapshot } from './route-snapshot'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const schema = z.object({ board: z.array(z.string()) })

test('a read that brings back the same data keeps the rendered object, so nothing re-renders', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let board = ['X']
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async () => Response.json({ board }),
  })
  const seen: (z.infer<typeof schema> | null)[] = []
  let latest!: PolledSnapshot<z.infer<typeof schema>>
  function Probe() {
    latest = usePolledSnapshot({
      path: '/rpc/game',
      schema,
      intervalMs: null,
      failureMessage: 'The board could not be read.',
    })
    seen.push(latest.snapshot)
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Probe />))
    const first = latest.snapshot
    expect(first).toEqual({ board: ['X'] })
    const renders = seen.length

    await act(async () => latest.refresh())
    await act(async () => latest.send({}))
    expect(latest.snapshot).toBe(first)
    // `send` re-renders for its pending count, never for the unchanged board.
    expect(seen.slice(renders).every((snapshot) => snapshot === first)).toBe(true)

    board = ['X', 'O']
    await act(async () => latest.refresh())
    expect(latest.snapshot).toEqual({ board: ['X', 'O'] })
    expect(latest.snapshot).not.toBe(first)
  } finally {
    await act(async () => root.unmount())
    unbind()
  }
})
