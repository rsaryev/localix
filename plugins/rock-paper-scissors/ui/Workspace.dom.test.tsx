import { afterAll, beforeAll, expect, test } from 'bun:test'
import { seal } from '@localixai/plugin-sdk/backend'
import type { PublishedMessageContext } from '@localixai/plugin-sdk/ui'
import { bindPluginUiRuntime, type PluginUiRuntime } from '@localixai/plugin-sdk/ui/runtime'
import { bindPluginUiTransport } from '@localixai/plugin-sdk/ui/transport'
import { WorkItemSessionProvider } from '@localixai/plugin-sdk/ui/work-item-session'
import { registerDom } from '@localixai/kit/testing'

import { applyMove, newGame, viewFor, type Game, type Move, type Player } from '../shared/game'

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
function fakeBackend(first: Player) {
  let game: Game = newGame({ id: 't1', roundId: 'r1', first, now: AT })
  const requests: { path: string; body?: unknown }[] = []
  const bodies: string[] = []
  const unbindTransport = bindPluginUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path.startsWith('/rpc/rock-paper-scissors/game/play')) {
        game = applyMove(game, seal((body as { move: Move }).move, 'you', AT), AT)
        if (game.round.outcome === null)
          game = { ...game, waiting: { since: new Date().toISOString(), status: 'thinking' } }
      }
      const text = JSON.stringify(viewFor(game, 'you'))
      bodies.push(text)
      return new Response(text, { headers: { 'Content-Type': 'application/json' } })
    },
  })
  const unbindRuntime = bindPluginUiRuntime({
    sessions: { list: () => [], subscribe: () => () => {} },
  } as unknown as PluginUiRuntime)
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

async function mount(sessionId: string | null, first: Player = 'you') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const backend = fakeBackend(first)
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
    settle: () => act(async () => new Promise((resolve) => setTimeout(resolve, 20))),
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
