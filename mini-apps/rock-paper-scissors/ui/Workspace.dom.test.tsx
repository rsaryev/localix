import { afterAll, beforeAll, expect, test } from 'bun:test'
import { seal } from '@localixai/mini-app-sdk/backend'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { registerDom } from '@localixai/kit/testing'

import { applyMove, newGame, viewFor, type Game, type Move, type Player } from '../shared/game'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

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

const AT = '2026-10-18T10:00:00.000Z'

/** A backend made of the real rules, answering with the person's view as the routes do. */
function fakeBackend(first: Player, unreachable?: string) {
  let game: Game = newGame({ id: 't1', roundId: 'r1', first, now: AT })
  const requests: { path: string; body?: unknown }[] = []
  const bodies: string[] = []
  const unbindTransport = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path.startsWith('/rpc/rock-paper-scissors/game/opponent'))
        game = { ...game, opponent: (body as { opponent: Game['opponent'] }).opponent }
      if (path.startsWith('/rpc/rock-paper-scissors/game/play')) {
        game = applyMove(game, seal((body as { move: Move }).move, 'you', AT), AT)
        const since = new Date().toISOString()
        if (game.round.outcome === null)
          game = {
            ...game,
            waiting: unreachable
              ? { since, status: 'unreachable', reason: unreachable }
              : { since, status: 'thinking' },
          }
      }
      const text = JSON.stringify(viewFor(game, 'you'))
      bodies.push(text)
      return new Response(text, { headers: { 'Content-Type': 'application/json' } })
    },
  })
  const unbindRuntime = bindMiniAppUiRuntime({
    sessions: { list: () => [], subscribe: () => () => {} },
  } as unknown as MiniAppUiRuntime)
  return {
    requests,
    bodies,
    agentPlays: (move: Move) => {
      game = applyMove(game, seal(move, 'agent', AT), AT)
    },
    unbind: () => {
      unbindTransport()
      unbindRuntime()
    },
  }
}

async function mount(sessionId: string | null, first: Player = 'you', unreachable?: string) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const backend = fakeBackend(first, unreachable)
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
  const button = (name: string) =>
    Array.from(host.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(name),
    )
  const hand = (label: string) => host.querySelector(`figure[aria-label^="${label}"]`)
  return {
    act,
    host,
    backend,
    button,
    hand,
    context: () => context,
    poll: async () => {
      await render(false)
      await render(true)
    },
    /** Let the browser's digest check settle. */
    settle: () => act(async () => turns()),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
      backend.unbind()
    },
  }
}

test('the agent opens sealed: the person sees a digest, picks, and the reveal checks out', async () => {
  const view = await mount('s1', 'agent')
  try {
    expect(view.host.querySelector('h1')?.textContent).toBe('Rock Paper Scissors')
    expect(view.button('Rock')?.disabled).toBe(true)

    view.backend.agentPlays('scissors')
    await view.poll()

    expect(view.hand('Agent')?.getAttribute('aria-label')).toBe('Agent: sealed')
    expect(view.host.textContent).toContain('Sealed — your turn')
    // Nothing the view received names the agent's move before the reveal.
    expect(view.backend.bodies.some((body) => body.includes('scissors'))).toBe(false)

    await view.act(async () => view.button('Rock')!.click())
    await view.settle()

    expect(view.backend.requests.filter(({ path }) => path.includes('/game/play'))).toEqual([
      { path: '/rpc/rock-paper-scissors/game/play?sessionId=s1', body: { move: 'rock' } },
    ])
    expect(view.hand('Agent')?.getAttribute('aria-label')).toBe('Agent: Scissors')
    expect(view.host.textContent).toContain('You won the round')
    expect(view.host.textContent).toContain('Rock blunts scissors.')
    expect(view.host.textContent).toContain('Digest checked')
    expect(view.button('Next round')).toBeDefined()
  } finally {
    await view.unmount()
  }
})

test('the person opens: their move shows to them, and stays out of what the agent reads', async () => {
  const view = await mount('s1', 'you')
  try {
    await view.act(async () => view.button('Paper')!.click())

    expect(view.hand('You')?.getAttribute('aria-label')).toBe('You: Paper')
    expect(view.host.textContent).toContain('Hidden from the agent')
    expect(view.host.textContent).toContain('Choosing')
    expect(view.button('Rock')?.disabled).toBe(true)
    const context = JSON.stringify(view.context())
    expect(context).toContain('The user has chosen (sealed).')
    expect(context).not.toContain('paper')
  } finally {
    await view.unmount()
  }
})

test('a table that belongs to no chat says so, and asks the server nothing', async () => {
  const view = await mount(null)
  try {
    expect(view.host.textContent).toContain('Open the table from a chat')
    expect(view.backend.requests).toEqual([])
  } finally {
    await view.unmount()
  }
})

test('the table says who plays against the person, under the score', async () => {
  const view = await mount('s1', 'you')
  try {
    expect(view.host.querySelector('[aria-label="Opponent: Chat agent"]')?.textContent).toContain(
      'Chat agent',
    )
  } finally {
    await view.unmount()
  }
})

test('an opponent that did not choose says why over the hands, outside the control row', async () => {
  const view = await mount('s1', 'you', 'This app cannot wake a chat.')
  try {
    await view.act(async () => view.button('Rock')!.click())

    const problem = view.host.querySelector('[data-slot="game-problem"]')!
    expect(problem.getAttribute('role')).toBe('alert')
    expect(problem.textContent).toContain('The agent did not choose')
    expect(problem.textContent).toContain('This app cannot wake a chat.')
    expect(view.host.querySelector('[data-slot="game-control-row"]')!.contains(problem)).toBe(false)

    const action = (label: string) =>
      Array.from(problem.querySelectorAll('button')).find((b) => b.textContent?.includes(label))
    expect(action('Ask again')).toBeDefined()
    await view.act(async () => action('Use the decision model')!.click())
    expect(view.backend.requests.some(({ path }) => path.includes('/game/opponent'))).toBe(true)
  } finally {
    await view.unmount()
  }
})
