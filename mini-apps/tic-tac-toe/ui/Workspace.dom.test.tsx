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

const AT = '2026-09-25T10:00:00.000Z'

/**
 * A backend made of the real rules: a move from the view places X and records that the chat was
 * woken; `agentPlays` is the agent's tool landing between two polls. The ACTIVE session the
 * runtime reports is deliberately a different chat from the board's own: the board must never
 * address it.
 */
function fakeBackend(failFirstRead = false, unreachable?: string) {
  let game: Game = newGame({ id: 'g1', first: 'X', now: AT })
  let readFailed = false
  const requests: { path: string; body?: unknown }[] = []
  const unbindTransport = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (failFirstRead && !readFailed && path.startsWith('/rpc/tic-tac-toe/game?')) {
        readFailed = true
        throw new Error('Temporary read failure')
      }
      if (path.startsWith('/rpc/tic-tac-toe/game/opponent')) {
        game = { ...game, opponent: (body as { opponent: Game['opponent'] }).opponent }
      }
      if (path.startsWith('/rpc/tic-tac-toe/game/move')) {
        const moved = applyMove(game, (body as { cell: number }).cell, 'you', AT)
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
    agentPlays: (cell: number) => {
      game = applyMove(game, cell, 'agent', AT)
    },
    unbind: () => {
      unbindTransport()
      unbindRuntime()
    },
  }
}

async function mount(sessionId: string | null, failFirstRead = false, unreachable?: string) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const backend = fakeBackend(failFirstRead, unreachable)
  let context: PublishedMessageContext | null = null
  const publish = (next: PublishedMessageContext | null) => {
    context = next
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  // The host wraps every mini app tab in the session it BELONGS to.
  const render = (active = true) =>
    act(async () =>
      root.render(
        <WorkItemSessionProvider sessionId={sessionId}>
          <Workspace active={active} publishMessageContext={publish} />
        </WorkItemSessionProvider>,
      ),
    )
  await render()
  const cell = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  return {
    act,
    host,
    backend,
    cell,
    render,
    context: () => context,
    /** Look again now — the next poll, without waiting for its interval. */
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

test('a click plays X, wakes the board’s own chat, and the agent’s move lands on the next look', async () => {
  const view = await mount('s1')
  try {
    expect(view.host.querySelector('h1')?.textContent).toBe('Tic-Tac-Toe')
    expect(view.host.textContent).toContain('Your turn')
    expect(view.cell('Cell 5, centre: empty')?.querySelector('.tic-tac-toe-preview')).not.toBeNull()

    await view.act(async () => view.cell('Cell 5, centre: empty')!.click())

    // The board's chat, not the one the runtime says is active.
    expect(view.backend.requests.filter(({ path }) => path.includes('/game/move'))).toEqual([
      { path: '/rpc/tic-tac-toe/game/move?sessionId=s1', body: { cell: 4 } },
    ])
    expect(view.backend.requests.every(({ path }) => path.endsWith('sessionId=s1'))).toBe(true)
    expect(view.host.textContent).toContain('Thinking')
    // While the agent owes a move no cell takes a click, and every one stays reachable by keyboard.
    expect(view.cell('Cell 1, top left: empty')?.getAttribute('aria-disabled')).toBe('true')

    view.backend.agentPlays(0)
    await view.poll()

    expect(view.cell('Cell 1, top left: O')).not.toBeNull()
    expect(view.host.textContent).toContain('Your turn')
    expect(view.host.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'The agent played the top left (cell 1).',
    )
    // What the agent reads beside the board is the board on screen.
    expect(JSON.stringify(view.context())).toContain('The user’s turn (X).')
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

test('an initial read failure offers a retry that restores the board', async () => {
  const view = await mount('s1', true)
  try {
    expect(view.host.textContent).toContain('The board is unavailable')
    const retry = Array.from(view.host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Try again'),
    )
    expect(retry).toBeDefined()
    await view.act(async () => retry!.click())
    expect(view.cell('Cell 5, centre: empty')).not.toBeNull()
    expect(view.host.textContent).toContain('You play X')
  } finally {
    await view.unmount()
  }
})

test('the arrow keys walk the board and stop at its edges', async () => {
  const view = await mount('s1')
  try {
    const first = view.cell('Cell 1, top left: empty')!
    first.focus()
    const press = (key: string) =>
      view.act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      })
    await press('ArrowRight')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Cell 2, top: empty')
    await press('ArrowDown')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Cell 5, centre: empty')
    await press('ArrowUp')
    await press('ArrowUp')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Cell 2, top: empty')
    await press('ArrowLeft')
    await press('ArrowLeft')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Cell 1, top left: empty')
  } finally {
    await view.unmount()
  }
})

test('the control row says who plays O, beside the new game', async () => {
  const view = await mount('s1')
  try {
    expect(view.cell('Opponent: Chat agent')).not.toBeNull()
    expect(view.cell('New game')).not.toBeNull()
    expect(view.host.textContent).toContain('You play X')
  } finally {
    await view.unmount()
  }
})

test('an opponent that did not move says why over the board, without moving the control row', async () => {
  const view = await mount('s1', false, 'This app cannot wake a chat.')
  try {
    const row = view.host.querySelector('[data-slot="game-control-row"]')!
    await view.act(async () => view.cell('Cell 5, centre: empty')!.click())

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
