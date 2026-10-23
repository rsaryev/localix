import { describe, expect, test } from 'bun:test'
import type { MiniAppWakeRequest } from '@localixai/mini-app-sdk/backend'

import type { WakeRequest } from '../chat/contracts'
import type { WakeOutcome } from '../triggers/delivery'
import { MINI_APP_WAKE_MESSAGE_MAX, createMiniAppWakes, frameMiniAppWake } from './mini-app-wake'

// Neutral mini app names on purpose: core may not name a bundled mini app, tests included.
const GAME = 'board-game'
const OPS = 'ops-console'

/** A host with one delivery that records what it was handed and answers `answer`. */
function host(answer: WakeOutcome = { status: 'delivered' }) {
  const delivered: WakeRequest[] = []
  const warned: Record<string, unknown>[] = []
  const wakes = createMiniAppWakes({
    deliver: async (request) => {
      delivered.push(request)
      return answer
    },
    logger: { warn: (entry) => warned.push(entry) },
  })
  wakes.recordTools([
    { name: GAME, toolNames: ['board_game_move', 'board_game_state'] },
    { name: OPS, toolNames: ['ops_console_pods'] },
  ])
  return { wakes, delivered, warned }
}

const move = (extra: Partial<MiniAppWakeRequest> = {}): MiniAppWakeRequest => ({
  userId: 'u1',
  sessionId: 's1',
  message: 'The user played X in the centre. Your move.',
  tools: ['board_game_move'],
  ...extra,
})

describe('a mini app wake reaches the session only as the contract allows', () => {
  test("a wake names only tools the mini app registered — another mini app's is refused by name", async () => {
    const { wakes, delivered } = host()

    const outcome = await wakes.forMiniApp(GAME)(
      move({ tools: ['board_game_move', 'ops_console_pods'] }),
    )

    expect(outcome.status).toBe('refused')
    expect(outcome.status === 'refused' && outcome.reason).toContain(
      'ops_console_pods is not a tool',
    )
    // The reason lists what the mini app DOES own, so the author can fix the name.
    expect(outcome.status === 'refused' && outcome.reason).toContain('board_game_state')
    expect(delivered).toEqual([])
  })

  test.each([
    ['an empty message', { message: '   ' }],
    ['a message past the cap', { message: 'x'.repeat(MINI_APP_WAKE_MESSAGE_MAX + 1) }],
    ['a key outside its alphabet', { key: 'game 1/move 2' }],
    ['no session', { sessionId: '' }],
  ] as const)('%s is refused and nothing is delivered', async (_label, extra) => {
    const { wakes, delivered } = host()

    const outcome = await wakes.forMiniApp(GAME)(move(extra))

    expect(outcome.status).toBe('refused')
    expect(delivered).toEqual([])
  })

  test('a delivered wake is framed, stamped `mini-app`, names its mini app and is keyed per mini app', async () => {
    const { wakes, delivered } = host()

    const outcome = await wakes.forMiniApp(GAME)(move({ key: 'g1:2' }))

    expect(outcome).toEqual({ status: 'delivered' })
    expect(delivered).toEqual([
      {
        userId: 'u1',
        sessionId: 's1',
        content: frameMiniAppWake(GAME, move().message, ['board_game_move']),
        source: 'mini-app',
        miniApp: GAME,
        deliveryKey: `mini-app:${GAME}:g1:2`,
      },
    ])
  })

  test('the frame tells the model who sent it, that the person did not, and what answers it', () => {
    const content = frameMiniAppWake(GAME, 'Your move.', ['board_game_move'])

    expect(content).toStartWith(`[From the "${GAME}" mini app`)
    expect(content).toContain('not typed by the user')
    expect(content).toContain('Answer with its tools: board_game_move.')
    expect(content).toEndWith('\n\nYour move.')
  })

  test('the same key from two mini apps is two deliveries, not one', async () => {
    const { wakes, delivered } = host()

    await wakes.forMiniApp(GAME)(move({ key: 'k1', tools: [] }))
    await wakes.forMiniApp(OPS)(move({ key: 'k1', tools: [] }))

    expect(delivered.map((request) => request.deliveryKey)).toEqual([
      `mini-app:${GAME}:k1`,
      `mini-app:${OPS}:k1`,
    ])
    // Each names the mini app that sent it — the one whose tools its turn carries.
    expect(delivered.map((request) => request.miniApp)).toEqual([GAME, OPS])
  })

  test("a rebuilt mini app's renamed tool is refused at once, because a load replaces the record", async () => {
    const { wakes } = host()
    wakes.recordTools([{ name: GAME, toolNames: ['board_game_play'] }])

    const outcome = await wakes.forMiniApp(GAME)(move())

    expect(outcome.status).toBe('refused')
  })

  test('a mini app loaded in two scopes owns the tools of both', async () => {
    const { wakes } = host()
    wakes.recordTools([
      { name: GAME, toolNames: ['board_game_move'] },
      { name: GAME, toolNames: ['board_game_state'] },
    ])

    const outcome = await wakes.forMiniApp(GAME)(
      move({ tools: ['board_game_move', 'board_game_state'] }),
    )

    expect(outcome).toEqual({ status: 'delivered' })
  })

  test("a miss is the mini app's to handle and is not logged; a failure is both", async () => {
    const missed = host({ status: 'missed', reason: 'gone' })
    expect(await missed.wakes.forMiniApp(GAME)(move())).toEqual({
      status: 'missed',
      reason: 'gone',
    })
    expect(missed.warned).toEqual([])

    const failed = host({ status: 'failed', detail: 'SQLITE_BUSY' })
    expect(await failed.wakes.forMiniApp(GAME)(move())).toEqual({
      status: 'failed',
      reason: 'SQLITE_BUSY',
    })
    expect(failed.warned).toMatchObject([{ event: 'mini_app_wake.failed', miniApp: GAME }])
  })
})
