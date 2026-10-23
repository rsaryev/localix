import { offerKeyToFocusedSurface } from '@localixai/mini-app-sdk/ui/focus'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { registerDom } from '@localixai/kit/testing'

import { newGame, type Direction, type Game, type Mode } from '../shared/game'
import { applyMove, playMoves } from '../shared/play'

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

const AT = '2026-09-29T10:00:00.000Z'
const first = () => 0

/**
 * A backend made of the real rules. `agentPlays` is the agent's tool landing between two polls.
 * The ACTIVE session the runtime reports is deliberately a different chat from the board's own:
 * the board must never address it.
 */
function fakeBackend(unreachable?: string) {
  let game: Game = {
    ...newGame({ id: 'g1', mode: 'user', now: AT, random: first }),
    board: [2, ...Array<number>(15).fill(0)],
  }
  const requests: { path: string; body?: unknown }[] = []
  const unbindTransport = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path.startsWith('/rpc/game-2048/game/move'))
        game = applyMove(game, (body as { direction: Direction }).direction, 'user', AT, first)
      if (path.startsWith('/rpc/game-2048/game/mode'))
        game = {
          ...game,
          mode: (body as { mode: Mode }).mode,
          waiting: unreachable
            ? { since: new Date().toISOString(), status: 'unreachable', reason: unreachable }
            : { since: new Date().toISOString(), status: 'thinking' },
        }
      if (path.startsWith('/rpc/game-2048/game/opponent'))
        game = { ...game, opponent: (body as { opponent: Game['opponent'] }).opponent }
      return Response.json(game)
    },
  })
  const unbindRuntime = bindMiniAppUiRuntime({
    sessions: { list: () => [], subscribe: () => () => {} },
  } as unknown as MiniAppUiRuntime)
  return {
    requests,
    agentPlays: (moves: Direction[]) => {
      game = playMoves(game, { moves }, 'agent', new Date().toISOString(), first).game
    },
    unbind: () => {
      unbindTransport()
      unbindRuntime()
    },
  }
}

async function mount(sessionId: string | null, unreachable?: string) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const backend = fakeBackend(unreachable)
  let context: PublishedMessageContext | null = null
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const dispatch = (event: KeyboardEvent) => offerKeyToFocusedSurface(event)
  window.addEventListener('keydown', dispatch)
  // The host wraps every mini app tab in the session it BELONGS to.
  const render = (active = true) =>
    act(async () =>
      root.render(
        <WorkItemSessionProvider sessionId={sessionId}>
          <Workspace
            active={active}
            publishMessageContext={(next) => {
              context = next
            }}
          />
        </WorkItemSessionProvider>,
      ),
    )
  await render()
  const tiles = () =>
    Array.from(host.querySelectorAll<HTMLElement>('.game-2048-tile'))
      .filter((tile) => tile.dataset.leaving !== 'true')
      .map((tile) => ({ cell: Number(tile.dataset.cell), value: Number(tile.textContent) }))
      .sort((a, b) => a.cell - b.cell)
  return {
    act,
    host,
    backend,
    tiles,
    context: () => context,
    /** Let `ms` of the replay run, its steps landing inside `act`. */
    settle: (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms))),
    press: (key: string) =>
      act(async () => {
        host
          .querySelector('.game-2048-board')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      }),
    /** Look again now — the next poll, without waiting for its interval. */
    poll: async () => {
      await render(false)
      await render(true)
    },
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
      window.removeEventListener('keydown', dispatch)
      backend.unbind()
    },
  }
}

test('an arrow key moves the board of the chat it belongs to, and the tile travels there', async () => {
  const view = await mount('s1')
  try {
    expect(view.host.querySelector('h1')?.textContent).toBe('2048')
    expect(view.host.textContent).toContain('Your move')
    expect(view.tiles()).toEqual([{ cell: 0, value: 2 }])
    const before = view.host.querySelector<HTMLElement>('.game-2048-tile')!

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    view.host
      .querySelector('.game-2048-board')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }),
      )
    expect(view.backend.requests.filter(({ path }) => path.includes('/game/move'))).toEqual([])

    await view.press('ArrowRight')

    expect(view.backend.requests.filter(({ path }) => path.includes('/game/move'))).toEqual([
      { path: '/rpc/game-2048/game/move?sessionId=s1', body: { direction: 'right' } },
    ])
    expect(view.backend.requests.every(({ path }) => path.endsWith('sessionId=s1'))).toBe(true)
    await view.settle(20)
    // The same element, now on the far cell: the tile slid rather than being redrawn.
    expect(before.dataset.cell).toBe('3')
    expect(view.tiles()).toEqual([
      { cell: 0, value: 2 },
      { cell: 3, value: 2 },
    ])
  } finally {
    await view.unmount()
  }
})

test('a key that would not move the board sends nothing', async () => {
  const view = await mount('s1')
  try {
    await view.press('ArrowLeft')
    await view.press('ArrowUp')
    expect(view.backend.requests.some(({ path }) => path.includes('/game/move'))).toBe(false)
  } finally {
    await view.unmount()
  }
})

test('handing the board to the agent shows it playing, and its batch lands move by move', async () => {
  const view = await mount('s1')
  try {
    const agent = view.host.querySelector<HTMLInputElement>('input[type="radio"][value="agent"]')!
    await view.act(async () => agent.click())
    expect(
      view.backend.requests.some(({ path }) =>
        path.startsWith('/rpc/game-2048/game/mode?sessionId=s1'),
      ),
    ).toBe(true)
    expect(view.host.textContent).toContain('Playing')
    // While the person watches, the row says who plays the board, and offers to stop it.
    expect(view.host.querySelector('[aria-label="Opponent: Chat agent"]')).not.toBeNull()
    expect(view.host.querySelector('[aria-label="Stop"]')).not.toBeNull()

    view.backend.agentPlays(['right', 'down', 'left'])
    await view.poll()
    await view.settle(500)
    expect(view.host.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'The agent made 3 moves.',
    )
    // What the agent reads beside the board is the board on screen.
    expect(JSON.stringify(view.context())).toContain('You control the board.')
    // Nothing the person presses moves the agent's board.
    await view.press('ArrowUp')
    expect(view.backend.requests.some(({ path }) => path.includes('/game/move'))).toBe(false)
  } finally {
    await view.unmount()
  }
})

test('a board that belongs to no chat says so, and asks the server nothing', async () => {
  const view = await mount(null)
  try {
    expect(view.host.textContent).toContain('Open 2048 from a chat')
    expect(view.backend.requests).toEqual([])
  } finally {
    await view.unmount()
  }
})

test('a player that stopped on its own says why over the board, with the ways out', async () => {
  const view = await mount('s1', 'This app cannot wake a chat.')
  try {
    const agent = view.host.querySelector<HTMLInputElement>('input[type="radio"][value="agent"]')!
    await view.act(async () => agent.click())

    const problem = view.host.querySelector('[data-slot="game-problem"]')!
    expect(problem.getAttribute('role')).toBe('alert')
    expect(problem.textContent).toContain('The agent stopped')
    expect(problem.textContent).toContain('This app cannot wake a chat.')
    // The card sits over the board, never in the row above it, which offers Continue instead.
    const row = view.host.querySelector('[data-slot="game-control-row"]')!
    expect(row.contains(problem)).toBe(false)
    expect(row.querySelector<HTMLButtonElement>('[aria-label="Continue"]')?.disabled).toBe(false)

    const button = (label: string) =>
      Array.from(problem.querySelectorAll('button')).find((b) => b.textContent?.includes(label))
    expect(button('Try again')).toBeDefined()
    await view.act(async () => button('Use the decision model')!.click())
    expect(view.backend.requests.some(({ path }) => path.includes('/game/opponent'))).toBe(true)
  } finally {
    await view.unmount()
  }
})
