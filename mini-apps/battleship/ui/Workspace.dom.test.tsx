import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { registerDom } from '@localixai/kit/testing'

import { applyShot, newGame, viewFor, type Game } from '../shared/game'
import { cellAt, cellName, type Ship } from '../shared/rules'

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
const ship = (...names: string[]): Ship => ({ cells: names.map((name) => cellAt(name)!) })
const FLEET: Ship[] = [
  ship('A1', 'B1', 'C1', 'D1'),
  ship('F1', 'G1', 'H1'),
  ship('A3', 'B3', 'C3'),
  ship('E3', 'F3'),
  ship('H3', 'I3'),
  ship('A5', 'B5'),
  ship('D5'),
  ship('F5'),
  ship('H5'),
  ship('J5'),
]

/**
 * A backend made of the real rules that answers — as the real routes do — with the PERSON's view
 * only. The ACTIVE session the runtime reports is a different chat from the board's own: the
 * board must never address it.
 */
function fakeBackend(unreachable?: string) {
  let game: Game = newGame({
    id: 'g1',
    first: 'you',
    fleets: { you: FLEET, agent: FLEET },
    now: AT,
  })
  const requests: { path: string; body?: unknown }[] = []
  const unbindTransport = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path.startsWith('/rpc/battleship/game/opponent')) {
        game = { ...game, opponent: (body as { opponent: Game['opponent'] }).opponent }
      }
      if (path.startsWith('/rpc/battleship/game/fire')) {
        const fired = applyShot(game, 'you', (body as { cell: number }).cell, AT)
        game =
          fired.turn === 'agent'
            ? {
                ...fired,
                waiting: unreachable
                  ? { since: new Date().toISOString(), status: 'unreachable', reason: unreachable }
                  : { since: new Date().toISOString(), status: 'thinking' },
              }
            : fired
      }
      return Response.json(viewFor(game, 'you'))
    },
  })
  const unbindRuntime = bindMiniAppUiRuntime({
    sessions: { list: () => [], subscribe: () => () => {} },
  } as unknown as MiniAppUiRuntime)
  return {
    requests,
    agentFires: (name: string) => {
      game = applyShot(game, 'agent', cellAt(name)!, AT)
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
  const enemy = (name: string) =>
    host.querySelector<HTMLButtonElement>(
      `[aria-label="The agent’s waters"] [aria-label^="${name}:"]`,
    )
  const own = (name: string) =>
    host.querySelector<HTMLElement>(`[aria-label="Your fleet"] [aria-label^="${name}:"]`)
  return {
    act,
    host,
    backend,
    enemy,
    own,
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

test('a hit keeps the shot, a miss wakes the board’s own chat, and the agent’s shot lands', async () => {
  const view = await mount('s1')
  try {
    expect(view.host.querySelector('h1')?.textContent).toBe('Battleship')
    expect(view.host.textContent).toContain('Your shot')
    expect(view.own('A1')?.getAttribute('aria-label')).toBe('A1: ship')
    expect(view.enemy('A1')?.getAttribute('aria-label')).toBe('A1: unknown')

    await view.act(async () => view.enemy('A1')!.click())
    expect(view.enemy('A1')?.getAttribute('aria-label')).toBe('A1: hit')
    expect(view.host.textContent).toContain('Your shot')

    await view.act(async () => view.enemy('J10')!.click())
    expect(view.host.textContent).toContain('Aiming')
    expect(view.enemy('B2')?.getAttribute('aria-disabled')).toBe('true')
    // Every request names the board's chat, never the active one.
    expect(view.backend.requests.every(({ path }) => path.endsWith('sessionId=s1'))).toBe(true)

    view.backend.agentFires('J9')
    await view.poll()
    expect(view.own('J9')?.getAttribute('aria-label')).toBe('J9: water')
    expect(view.host.textContent).toContain('Your shot')
  } finally {
    await view.unmount()
  }
})

test('what the board tells the agent never names the person’s ships', async () => {
  const view = await mount('s1')
  try {
    const context = JSON.stringify(view.context())
    expect(context).toContain('Their fleet is hidden from you.')
    for (const cell of FLEET.flatMap((s) => s.cells)) expect(context).not.toContain(cellName(cell))
  } finally {
    await view.unmount()
  }
})

test('the fleet can be placed anew before the first shot, not after', async () => {
  const view = await mount('s1')
  const shuffle = () =>
    Array.from(view.host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('New fleet'),
    )
  try {
    expect(shuffle()).toBeDefined()
    await view.act(async () => view.enemy('J10')!.click())
    expect(shuffle()).toBeUndefined()
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

test('the control row says who fires at the person’s fleet, beside the new game', async () => {
  const view = await mount('s1')
  try {
    expect(view.host.querySelector('[aria-label="Opponent: Chat agent"]')).not.toBeNull()
    expect(view.host.querySelector('[aria-label="New game"]')).not.toBeNull()
  } finally {
    await view.unmount()
  }
})

test('an opponent that did not fire says why over the boards, not in the control row', async () => {
  const view = await mount('s1', 'This app cannot wake a chat.')
  try {
    await view.act(async () => view.enemy('J10')!.click())

    const row = view.host.querySelector('[data-slot="game-control-row"]')!
    const problem = view.host.querySelector('[data-slot="game-problem"]')!
    expect(problem.getAttribute('role')).toBe('alert')
    expect(problem.textContent).toContain('The agent did not fire')
    expect(problem.textContent).toContain('This app cannot wake a chat.')
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
