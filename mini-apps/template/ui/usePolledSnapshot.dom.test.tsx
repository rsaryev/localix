import { afterAll, beforeAll, expect, test } from 'bun:test'
import { z } from 'zod'
import { bindPluginUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { registerDom } from '@localixai/kit/testing'
import type { PolledSnapshot } from './usePolledSnapshot'

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

const counter = z.object({ count: z.number() })
type Counter = z.infer<typeof counter>

/**
 * A click's answer and the poll's answer were two snapshots, and the copy showed the
 * wrong one — the countdown froze after the first click, and a poll that left before a click
 * and landed after it put the old state back. `send` makes the action's answer THE snapshot, and a
 * poll that overlapped it is dropped.
 */
test('an action shows its answer at once, and a poll that overlapped it cannot undo it', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { usePolledSnapshot } = await import('./usePolledSnapshot')

  let server: Counter = { count: 0 }
  const heldPolls: Array<() => void> = []
  let holdPolls = false
  const unbind = bindPluginUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
          by?: number
        }
        if (!body.by)
          return Response.json(
            { error: { code: 'bad', message: 'Say how much to add.' } },
            { status: 400 },
          )
        server = { count: server.count + body.by }
        return Response.json(server)
      }
      const answer = { ...server }
      if (!holdPolls) return Response.json(answer)
      return new Promise<Response>((resolve) =>
        heldPolls.push(() => resolve(Response.json(answer))),
      )
    },
  })
  let hook: PolledSnapshot<Counter> | null = null
  function Probe() {
    hook = usePolledSnapshot({
      path: '/rpc/probe/counter',
      schema: counter,
      intervalMs: 60_000,
      failureMessage: 'Cannot read the counter.',
    })
    return <p>{hook.snapshot?.count ?? 'none'}</p>
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Probe />))
    expect(host.textContent).toBe('0')

    // A poll leaves BEFORE the click and is held until after the click has answered.
    holdPolls = true
    await act(async () => hook!.refresh())
    await act(async () => {
      await hook!.send({ by: 1 })
    })
    expect(host.textContent).toBe('1')
    await act(async () => heldPolls.shift()!())
    expect(host.textContent).toBe('1')

    // A refused action keeps the state and says why, in the route's words.
    holdPolls = false
    await act(async () => {
      expect(await hook!.send({})).toBeNull()
    })
    expect(host.textContent).toBe('1')
    expect(hook!.error).toBe('Say how much to add.')
    expect(hook!.sending).toBe(false)
  } finally {
    await act(async () => root.unmount())
    unbind()
    host.remove()
  }
})
