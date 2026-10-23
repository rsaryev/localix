import { afterAll, beforeAll, expect, test } from 'bun:test'
import { z } from 'zod'
import { registerDom } from '@localixai/kit/testing/dom'

import { useTableGame } from './game-table'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from './runtime'
import { bindMiniAppUiTransport } from './transport'
import { WorkItemSessionProvider } from './work-item-session'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const schema = z.object({ moves: z.number(), owes: z.boolean() })
type Game = z.infer<typeof schema>

/** A board on `sessionId`, over a backend that records every request and plays a move. */
async function mount(sessionId: string | null) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let game: Game = { moves: 0, owes: false }
  const requests: { path: string; body?: unknown }[] = []
  const unbindTransport = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path.includes('/game/move')) game = { moves: game.moves + 1, owes: true }
      return Response.json(game)
    },
  })
  const unbindRuntime = bindMiniAppUiRuntime({
    sessions: { list: () => [], subscribe: () => () => {} },
  } as unknown as MiniAppUiRuntime)
  let latest!: ReturnType<typeof useTableGame<Game>>
  function Probe() {
    latest = useTableGame({
      miniApp: 'toy',
      route: '/rpc/toy',
      schema,
      active: true,
      quick: (snapshot) => snapshot?.owes ?? false,
      failureMessage: 'The board could not be read.',
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      <WorkItemSessionProvider sessionId={sessionId}>
        <Probe />
      </WorkItemSessionProvider>,
    ),
  )
  return {
    act,
    requests,
    game: () => latest,
    unmount: async () => {
      await act(async () => root.unmount())
      unbindTransport()
      unbindRuntime()
    },
  }
}

test('the board reads and acts on its own chat, and shows the action’s answer', async () => {
  const board = await mount('s 1')
  try {
    expect(board.game().hasTable).toBe(true)
    expect(board.game().snapshot).toEqual({ moves: 0, owes: false })
    await board.act(async () => board.game().act('move', { cell: 4 }))
    expect(board.game().snapshot).toEqual({ moves: 1, owes: true })
    expect(board.requests.slice(0, 2)).toEqual([
      { path: '/rpc/toy/game?sessionId=s%201' },
      { path: '/rpc/toy/game/move?sessionId=s%201', body: { cell: 4 } },
    ])
    // The answer says the other side owes a turn: the board looks again, still at its own chat.
    expect(board.requests.every(({ path }) => path.endsWith('?sessionId=s%201'))).toBe(true)
  } finally {
    await board.unmount()
  }
})

test('a board that belongs to no chat has no table, and asks the server nothing', async () => {
  const board = await mount(null)
  try {
    expect(board.game().hasTable).toBe(false)
    expect(board.game().snapshot).toBeNull()
    expect(board.requests).toEqual([])
  } finally {
    await board.unmount()
  }
})
