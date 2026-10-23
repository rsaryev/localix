import { offerKeyToFocusedSurface } from '@localixai/mini-app-sdk/ui/focus'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { registerDom } from '@localixai/kit/testing'

import { newGame, replay, type Direction, type Game, type Mode } from '../shared/game'

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  if (priorActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment
})

/** A backend made of the real rules: saved headings are replayed like the route does. */
function fakeBackend(unreachable?: string) {
  let game: Game = newGame({ id: 'g1', mode: 'user', now: 'now', seed: 3 })
  const requests: { path: string; body?: unknown }[] = []
  const unbindTransport = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path.startsWith('/rpc/snake/game/turns'))
        game = replay(game, (body as { headings: Direction[] }).headings)
      if (path.startsWith('/rpc/snake/game/mode'))
        game = {
          ...game,
          mode: (body as { mode: Mode }).mode,
          waiting: unreachable
            ? { since: 'now', status: 'unreachable', reason: unreachable }
            : { since: 'now', status: 'thinking' },
        }
      return Response.json(game)
    },
  })
  const unbindRuntime = bindMiniAppUiRuntime({
    sessions: { list: () => [], subscribe: () => () => {} },
  } as unknown as MiniAppUiRuntime)
  return {
    requests,
    game: () => game,
    unbind: () => {
      unbindTransport()
      unbindRuntime()
    },
  }
}

async function mount(unreachable?: string) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const backend = fakeBackend(unreachable)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const dispatch = (event: KeyboardEvent) => offerKeyToFocusedSurface(event)
  window.addEventListener('keydown', dispatch)
  await act(async () =>
    root.render(
      <WorkItemSessionProvider sessionId="s1">
        <Workspace active />
      </WorkItemSessionProvider>,
    ),
  )
  return {
    act,
    host,
    backend,
    head: () => host.querySelector('.snake-layer')?.getAttribute('data-head'),
    settle: (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms))),
    press: (key: string) =>
      act(async () => {
        host
          .querySelector('.snake-board')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      }),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
      window.removeEventListener('keydown', dispatch)
      backend.unbind()
    },
  }
}

test('an arrow key starts the snake in the view, and leaving saves exactly what was played', async () => {
  const view = await mount()
  let saved = false
  try {
    expect(view.host.textContent).toContain('Press an arrow key')
    const start = view.head()
    await view.press('ArrowDown')
    await view.settle(500)
    expect(view.head()).not.toBe(start)
    await view.unmount()
    saved = true
    await new Promise((resolve) => setTimeout(resolve, 0))
    // On a slow machine a periodic save may land before leaving: whatever the batches, together
    // they are exactly what was played, from the first tick on, in order.
    const saves = view.backend.requests
      .filter(({ path }) => path.includes('/game/turns'))
      .map(({ path, body }) => ({ path, ...(body as { fromTick: number; headings: Direction[] }) }))
    expect(saves.length).toBeGreaterThan(0)
    expect(saves.every(({ path }) => path === '/rpc/snake/game/turns?sessionId=s1')).toBe(true)
    expect(saves[0]!.fromTick).toBe(0)
    expect(saves[0]!.headings[0]).toBe('down')
    let tick = 0
    for (const save of saves) {
      expect(save.fromTick).toBe(tick)
      tick += save.headings.length
    }
    expect(view.backend.game().tick).toBe(tick)
  } finally {
    if (!saved) await view.unmount()
  }
})

test('Model plays hands the board to the decision model', async () => {
  const view = await mount()
  try {
    const label = Array.from(view.host.querySelectorAll('label')).find((element) =>
      element.textContent?.includes('Model plays'),
    )
    await view.act(async () =>
      label!.querySelector<HTMLInputElement>('input[type="radio"]')!.click(),
    )
    expect(view.backend.requests.filter(({ path }) => path.includes('/game/mode'))).toEqual([
      { path: '/rpc/snake/game/mode?sessionId=s1', body: { mode: 'model' } },
    ])
    expect(view.host.textContent).toContain('Playing')
  } finally {
    await view.unmount()
  }
})

test('a model that cannot play says why over the board, and offers the board back', async () => {
  const view = await mount('No decision model is connected.')
  try {
    const label = Array.from(view.host.querySelectorAll('label')).find((element) =>
      element.textContent?.includes('Model plays'),
    )
    await view.act(async () =>
      label!.querySelector<HTMLInputElement>('input[type="radio"]')!.click(),
    )
    const problem = view.host.querySelector('[data-slot="game-problem"]')!
    expect(problem.textContent).toContain('The decision model stopped')
    expect(problem.textContent).toContain('No decision model is connected.')
    // The reason is never written into the row above the board, where it pushed the board down.
    const row = view.host.querySelector('[data-slot="game-control-row"]')!
    expect(row.textContent).not.toContain('No decision model is connected.')
    expect(row.querySelector('[aria-label="Continue"]')).not.toBeNull()

    const yourself = Array.from(problem.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Play it yourself'),
    )
    await view.act(async () => yourself!.click())
    const modes = view.backend.requests.filter(({ path }) => path.includes('/game/mode'))
    expect(modes.at(-1)?.body).toEqual({ mode: 'user' })
  } finally {
    await view.unmount()
  }
})
