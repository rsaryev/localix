import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { registerDom } from '@localixai/kit/testing'

import { applyMove, newGame, type Game } from '../shared/game'

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

const AT = '2026-09-26T10:00:00.000Z'

/**
 * A backend made of the real rules: a move from the view is played and records that the chat was
 * woken; `agentPlays` is the agent's tool landing between two polls. The ACTIVE session the
 * runtime reports is deliberately a different chat from the board's own: the board must never
 * address it.
 */
function fakeBackend(unreachable?: string) {
  let game: Game = newGame({ id: 'g1', you: 'white', now: AT })
  const requests: { path: string; body?: unknown }[] = []
  const unbindTransport = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path.startsWith('/rpc/chess/game/opponent')) {
        game = { ...game, opponent: (body as { opponent: Game['opponent'] }).opponent }
      }
      if (path.startsWith('/rpc/chess/game/move')) {
        const moved = applyMove(game, (body as { move: string }).move, 'you', AT)
        const since = new Date().toISOString()
        game = {
          ...moved,
          waiting: unreachable
            ? { since, status: 'unreachable', reason: unreachable }
            : { since, status: 'thinking' },
        }
      }
      return Response.json(game)
    },
  })
  const unbindRuntime = bindMiniAppUiRuntime({
    sessions: { list: () => [], subscribe: () => () => {} },
  } as unknown as MiniAppUiRuntime)
  return {
    requests,
    agentPlays: (move: string) => {
      game = applyMove(game, move, 'agent', AT)
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
  const render = (active = true) =>
    act(async () =>
      root.render(
        <WorkItemSessionProvider sessionId={sessionId}>
          <Workspace active={active} publishMessageContext={(next) => (context = next)} />
        </WorkItemSessionProvider>,
      ),
    )
  await render()
  const square = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label^="${name}:"]`)
  return {
    act,
    host,
    backend,
    square,
    click: (name: string) => act(async () => square(name)!.click()),
    context: () => context,
    poll: async () => {
      await render(false)
      await render(true)
    },
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
      backend.unbind()
    },
  }
}

test('two clicks play a move, wake the board’s own chat, and the agent’s reply lands', async () => {
  const view = await mount('s1')
  try {
    expect(view.host.querySelector('h1')?.textContent).toBe('Chess')
    expect(view.host.textContent).toContain('Your turn')
    expect(view.square('e2')?.getAttribute('aria-label')).toBe('e2: white pawn')

    await view.click('e2')
    expect(view.square('e4')?.querySelector('.chess-target')).not.toBeNull()
    expect(view.square('e5')?.getAttribute('aria-disabled')).toBe('true')
    await view.click('e4')

    expect(view.backend.requests.filter(({ path }) => path.includes('/game/move'))).toEqual([
      { path: '/rpc/chess/game/move?sessionId=s1', body: { move: 'e2e4' } },
    ])
    expect(view.backend.requests.every(({ path }) => path.endsWith('sessionId=s1'))).toBe(true)
    expect(view.host.textContent).toContain('Thinking')

    view.backend.agentPlays('e5')
    await view.poll()

    expect(view.square('e5')?.getAttribute('aria-label')).toBe('e5: black pawn')
    expect(view.host.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'The agent played e5.',
    )
    expect(JSON.stringify(view.context())).toContain('The user’s turn (white).')
  } finally {
    await view.unmount()
  }
})

test('a board that belongs to no chat says so, and asks the server nothing', async () => {
  const view = await mount(null)
  try {
    expect(view.host.textContent).toContain('Open the board from a chat')
    expect(view.backend.requests).toEqual([])
  } finally {
    await view.unmount()
  }
})

test('the control row says who plays the other colour, beside the new game', async () => {
  const view = await mount('s1')
  try {
    expect(view.host.querySelector('[aria-label="Opponent: Chat agent"]')).not.toBeNull()
    expect(view.host.querySelector('[aria-label="New game"]')).not.toBeNull()
    expect(view.host.textContent).toContain('You play White')
    expect(view.host.textContent).not.toContain('Agent plays')
  } finally {
    await view.unmount()
  }
})

test('an opponent that did not move says why over the board, without moving the control row', async () => {
  const view = await mount('s1', 'This app cannot wake a chat.')
  try {
    const row = view.host.querySelector('[data-slot="game-control-row"]')!
    await view.click('e2')
    await view.click('e4')

    const problem = view.host.querySelector('[data-slot="game-problem"]')!
    expect(problem.getAttribute('role')).toBe('alert')
    expect(problem.textContent).toContain('The agent did not move')
    expect(problem.textContent).toContain('This app cannot wake a chat.')
    // The card sits over the board, never in the row above it.
    expect(row.contains(problem)).toBe(false)

    const button = (label: string) =>
      Array.from(problem.querySelectorAll('button')).find((b) => b.textContent?.includes(label))
    expect(button('Ask again')).toBeDefined()
    await view.act(async () => button('Use the decision model')!.click())
    expect(view.backend.requests.some(({ path }) => path.includes('/game/opponent'))).toBe(true)
  } finally {
    await view.unmount()
  }
})
