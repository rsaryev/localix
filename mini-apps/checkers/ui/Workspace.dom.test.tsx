import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { registerDom } from '@localixai/kit/testing'

import { applyMove, newGame, type Game } from '../shared/game'
import { parseSquares } from '../shared/notation'

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
 * A backend made of the real rules: a move from the view is played and records that the chat was
 * woken; `agentPlays` is the agent's tool landing between two polls. The ACTIVE session the
 * runtime reports is deliberately a different chat from the board's own: the board must never
 * address it.
 */
function fakeBackend(failFirstRead = false, unreachable?: string) {
  let game: Game = newGame({ id: 'g1', you: 'white', now: AT })
  let readFailed = false
  const requests: { path: string; body?: unknown }[] = []
  const unbindTransport = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (failFirstRead && !readFailed && path.startsWith('/rpc/checkers/game?')) {
        readFailed = true
        throw new Error('Temporary read failure')
      }
      if (path.startsWith('/rpc/checkers/game/opponent')) {
        game = { ...game, opponent: (body as { opponent: Game['opponent'] }).opponent }
      }
      if (path.startsWith('/rpc/checkers/game/move')) {
        const moved = applyMove(game, (body as { squares: number[] }).squares, 'you', AT)
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
      game = applyMove(game, parseSquares(move), 'agent', AT)
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
  const square = (name: string) =>
    host.querySelector<HTMLButtonElement>(`[aria-label^="Square ${name}:"]`)
  return {
    act,
    host,
    backend,
    square,
    click: (name: string) => act(async () => square(name)!.click()),
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

test('two clicks play a move, wake the board’s own chat, and the agent’s move lands on the next look', async () => {
  const view = await mount('s1')
  try {
    expect(view.host.querySelector('h1')?.textContent).toBe('Checkers')
    expect(view.host.textContent).toContain('Your turn')
    expect(view.square('c3')?.getAttribute('aria-label')).toBe('Square c3: white man')

    await view.click('c3')
    expect(view.square('c3')?.getAttribute('aria-pressed')).toBe('true')
    // The picked man shows where it can go; nowhere else takes a click.
    expect(view.square('d4')?.querySelector('.checkers-target')).not.toBeNull()
    expect(view.square('c4')?.getAttribute('aria-disabled')).toBe('true')
    await view.click('d4')

    expect(view.backend.requests.filter(({ path }) => path.includes('/game/move'))).toEqual([
      { path: '/rpc/checkers/game/move?sessionId=s1', body: { squares: parseSquares('c3-d4') } },
    ])
    // Every request names the board's chat, never the active one.
    expect(view.backend.requests.every(({ path }) => path.endsWith('sessionId=s1'))).toBe(true)
    expect(view.host.textContent).toContain('Thinking')
    // While the agent owes a move no square takes a click.
    expect(view.square('e3')?.getAttribute('aria-disabled')).toBe('true')

    view.backend.agentPlays('f6-e5')
    await view.poll()

    expect(view.square('e5')?.getAttribute('aria-label')).toBe('Square e5: black man')
    expect(view.host.textContent).toContain('capture is compulsory')
    expect(view.host.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'The agent played f6-e5.',
    )
    // Only the man that must capture takes a click.
    expect(view.square('a3')?.getAttribute('aria-disabled')).toBe('true')
    expect(view.square('d4')?.getAttribute('aria-disabled')).toBe('false')
    // What the agent reads beside the board is the board on screen.
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

test('an initial read failure offers a retry that restores the board', async () => {
  const view = await mount('s1', true)
  try {
    expect(view.host.textContent).toContain('The board is unavailable')
    const retry = Array.from(view.host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Try again'),
    )
    expect(retry).toBeDefined()
    await view.act(async () => retry!.click())
    expect(view.square('c3')).not.toBeNull()
    expect(view.host.textContent).toContain('You play White (12) · Black (12)')
  } finally {
    await view.unmount()
  }
})

test('the arrow keys walk the board and stop at its edges', async () => {
  const view = await mount('s1')
  try {
    view.square('a8')!.focus()
    const press = (key: string) =>
      view.act(async () => {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      })
    const focused = () => document.activeElement?.getAttribute('aria-label')?.split(':')[0]
    await press('ArrowRight')
    expect(focused()).toBe('Square b8')
    await press('ArrowDown')
    expect(focused()).toBe('Square b7')
    await press('ArrowUp')
    await press('ArrowUp')
    expect(focused()).toBe('Square b8')
    await press('ArrowLeft')
    await press('ArrowLeft')
    expect(focused()).toBe('Square a8')
  } finally {
    await view.unmount()
  }
})

test('the control row says who plays the other colour, beside the new game', async () => {
  const view = await mount('s1')
  try {
    expect(view.host.querySelector('[aria-label="Opponent: Chat agent"]')).not.toBeNull()
    expect(view.host.querySelector('[aria-label="New game"]')).not.toBeNull()
  } finally {
    await view.unmount()
  }
})

test('an opponent that did not move says why over the board, without moving the control row', async () => {
  const view = await mount('s1', false, 'This app cannot wake a chat.')
  try {
    const row = view.host.querySelector('[data-slot="game-control-row"]')!
    await view.click('c3')
    await view.click('d4')

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
