import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { PublishedMessageContext } from '@localixai/plugin-sdk/ui'
import { bindPluginUiRuntime, type PluginUiRuntime } from '@localixai/plugin-sdk/ui/runtime'
import { bindPluginUiTransport } from '@localixai/plugin-sdk/ui/transport'
import { WorkItemSessionProvider } from '@localixai/plugin-sdk/ui/work-item-session'
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
function fakeBackend() {
  let game: Game = newGame({ id: 'g1', you: 'white', now: AT })
  const requests: { path: string; body?: unknown }[] = []
  const unbindTransport = bindPluginUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path.startsWith('/rpc/chess/game/move')) {
        const moved = applyMove(game, (body as { move: string }).move, 'you', AT)
        game = { ...moved, waiting: { since: new Date().toISOString(), status: 'thinking' } }
      }
      return Response.json(game)
    },
  })
  const unbindRuntime = bindPluginUiRuntime({
    sessions: { list: () => [], subscribe: () => () => {} },
  } as unknown as PluginUiRuntime)
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

async function mount(sessionId: string | null) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const backend = fakeBackend()
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
    expect(view.host.textContent).toContain('The agent is thinking')

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
