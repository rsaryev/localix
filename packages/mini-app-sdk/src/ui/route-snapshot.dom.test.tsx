import { afterAll, beforeAll, expect, test } from 'bun:test'
import { useEffect } from 'react'
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
    const polled = usePolledSnapshot({
      path: '/rpc/game',
      schema,
      intervalMs: null,
      failureMessage: 'The board could not be read.',
    })
    seen.push(polled.snapshot)
    useEffect(() => {
      latest = polled
    })
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

test("a new route starts empty at once, and the old route's late answer never lands on it", async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const answers = new Map<string, (board: string[]) => void>()
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: (path) =>
      new Promise<Response>((resolve) =>
        answers.set(path, (board) => resolve(Response.json({ board }))),
      ),
  })
  const views: { path: string; polled: PolledSnapshot<z.infer<typeof schema>> }[] = []
  function Probe({ path }: { path: string }) {
    const polled = usePolledSnapshot({
      path,
      schema,
      intervalMs: null,
      failureMessage: 'The board could not be read.',
    })
    // Recorded on commit: only what the screen could show counts.
    useEffect(() => {
      views.push({ path, polled })
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Probe path="/rpc/a" />))
    await act(async () => answers.get('/rpc/a')!(['A']))
    expect(views.at(-1)!.polled.snapshot).toEqual({ board: ['A'] })

    await act(async () => root.render(<Probe path="/rpc/b" />))
    // No render of the new route ever shows the old route's board.
    expect(
      views.filter((view) => view.path === '/rpc/b').map((view) => view.polled.snapshot),
    ).toEqual(views.filter((view) => view.path === '/rpc/b').map(() => null))
    expect(views.at(-1)!.polled.loading).toBe(true)

    await act(async () => answers.get('/rpc/b')!(['B']))
    expect(views.at(-1)!.polled.snapshot).toEqual({ board: ['B'] })
  } finally {
    await act(async () => root.unmount())
    unbind()
  }
})
