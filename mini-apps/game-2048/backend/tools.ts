import { classifyByAction, type MiniAppContext } from '@localixai/mini-app-sdk/backend'

import { describeGame, drawBoard, endLine } from '../shared/describe'
import {
  directions,
  legalDirections,
  MAX_MOVES,
  modes,
  MoveRefused,
  type Game,
} from '../shared/game'
import type { Plan, Played } from '../shared/play'
import { gameUri } from '../shared/resource'
import type { ChatRef } from './ask-agent'
import type { GameService } from './game-service'

/**
 * Without a classifier the tool's static `mutates: true` read as `external`, so a read-only plan
 * session refused even `state`. Reading the board is a read; every other action changes only
 * this chat's game, which is deleted with the chat — `session`.
 */
export const classifyGame2048Call = classifyByAction({
  state: { effect: 'read' },
  move: { effect: 'session' },
  new_game: { effect: 'session' },
})

/**
 * The agent's side of the board — ONE tool, `game_2048`, whose `action` says what it does: play
 * moves, read the board, start a game. One tool, because every tool's schema rides in every
 * request of every run the mini app is loaded for.
 *
 * Every action acts on the board of the chat the call RUNS in, so an agent in one chat can never
 * touch another chat's board.
 *
 * A "move" call carries a PLAN (`shared/play.ts`): an exact `moves` list, or a `prefer` order that
 * each move resolves against the board as it is then. The first shape alone left the agent unable
 * to say "down, else left, else right" — the strategy its own skill describes — so it alternated
 * two directions and most of its moves were no-ops. `isError` is kept for a call that played
 * nothing, which is a call the agent got wrong.
 *
 * The same plan played twice is two different moves on two different boards, so the tool declares
 * `idempotentHint: false`: the host's repeat guard then counts a repeat only when the RESULT
 * repeats too, instead of stopping a game the agent is playing well.
 */

/** What the agent is asked when a game ends. */
export const GAME_OVER_ASK =
  'The game is over. Tell the user the result in one short line, and offer another game.'
/** What the agent is asked while the board is still its to play. */
export const PLAY_ON = 'Continue: call game_2048 with the next moves until the game ends.'

type Result = { content: string; isError?: boolean; details?: unknown }
interface PlanInput {
  moves?: readonly (typeof directions)[number][]
  prefer?: readonly (typeof directions)[number][]
  count?: number
}

/** The table a tool call acts on: the chat the call runs in. */
function chatOf(ctx: MiniAppContext, context: { session?: { id: string } } | undefined): ChatRef {
  const sessionId = context?.session?.id
  if (!sessionId) throw new MoveRefused('2048 is played in a chat; this call has none.')
  return { userId: ctx.userId, sessionId }
}

/** The plan a call names, or null when it names none; a plan it names half of is refused. */
function planOf(input: PlanInput): Plan | null {
  if (input.moves && input.prefer)
    throw new MoveRefused('Use either "moves" or "prefer", not both.')
  if (input.count !== undefined && !input.prefer)
    throw new MoveRefused('"count" goes with "prefer"; a "moves" list plays each of its moves.')
  if (input.moves) return { moves: input.moves }
  if (!input.prefer) return null
  if (new Set(input.prefer).size !== input.prefer.length)
    throw new MoveRefused('Name each direction in "prefer" once, most preferred first.')
  return { prefer: input.prefer, count: input.count ?? MAX_MOVES }
}

/** What to do next with the board as it is now. */
function nextLine(game: Game): string {
  if (game.status !== 'playing') return GAME_OVER_ASK
  if (game.mode === 'user') return 'The user is playing; move only if they hand you the board.'
  if (game.opponent === 'decision')
    return 'The decision model plays this board, so do not move; the user starts it from the board.'
  return PLAY_ON
}

/** "Played 9 of 12 moves; skipped 3 …" or "Played 32 moves by preference down > left > right". */
function playedLine(result: Played, plan: Plan): string {
  const { played, skipped, unplayed, stop } = result
  const parts =
    'moves' in plan
      ? [`Played ${played.length} of ${plan.moves.length} moves`]
      : [`Played ${played.length} moves by preference ${plan.prefer.join(' > ')}`]
  if (skipped.length)
    parts.push(`skipped ${skipped.length} that would not change the board (${skipped.join(', ')})`)
  if (stop === 'stuck' && 'prefer' in plan)
    parts.push(`stopped with ${unplayed} to go: none of ${plan.prefer.join(', ')} moves the board`)
  if (stop === 'ended' && unplayed) parts.push(`the game ended before the last ${unplayed}`)
  return `${parts.join('; ')}.`
}

function afterMoves(result: Played, plan: Plan): Result {
  const { game } = result
  if (result.played.length === 0) {
    const tried = 'moves' in plan ? result.skipped : plan.prefer
    return {
      content: [
        `None of these moves changes the board: ${tried.join(', ')}. Directions that move it: ${legalDirections(game.board).join(', ')}.`,
        '',
        drawBoard(game),
      ].join('\n'),
      isError: true,
    }
  }
  return { content: [playedLine(result, plan), describeGame(game), '', nextLine(game)].join('\n') }
}

export function createGameTools(ctx: MiniAppContext, games: GameService) {
  const openBoard = (chat: ChatRef) =>
    ctx.ui.offer({
      uri: gameUri(chat.sessionId),
      label: 'Open 2048',
      description: 'This chat’s game',
    })
  const direction = ctx.z.enum(directions)

  return [
    ctx.defineTool({
      name: 'game_2048',
      label: '2048',
      activeVerb: 'Playing 2048',
      description: `Play or read this chat’s 2048 board. "move" plays either "prefer" — an order of directions, each move taking the first that changes the board, for "count" moves (default ${MAX_MOVES}) — or an exact "moves" list, skipping any that would not change the board. "state" reads the board; "new_game" starts a game.`,
      inputSchema: ctx.z.object({
        action: ctx.z
          .enum(['move', 'state', 'new_game'])
          .describe('What to do on this chat’s board.'),
        prefer: ctx.z
          .array(direction)
          .min(1)
          .max(4)
          .optional()
          .describe(
            'For "move": directions most preferred first, e.g. ["down","left","right","up"] to keep the largest tile bottom left.',
          ),
        count: ctx.z
          .number()
          .int()
          .min(1)
          .max(MAX_MOVES)
          .optional()
          .describe(`With "prefer": how many moves to play (default ${MAX_MOVES}).`),
        moves: ctx.z
          .array(direction)
          .min(1)
          .max(MAX_MOVES)
          .optional()
          .describe('For "move": exact directions to play in order, e.g. ["down","left"].'),
        mode: ctx.z
          .enum(modes)
          .optional()
          .describe(
            'For "new_game": who controls the board — "agent" to play it yourself (a plan may follow in the same call), "user" (default) to let the user play.',
          ),
      }),
      executionMode: 'sequential',
      mutates: true,
      classify: classifyGame2048Call,
      behaviorHints: { idempotentHint: false },
      permissionPaths: () => [],
      async execute(_toolCallId, input, _signal, _onUpdate, context) {
        let chat: ChatRef | null = null
        try {
          chat = chatOf(ctx, context)
          if (input.action === 'state') {
            const game = await games.read(chat)
            return { content: [describeGame(game), '', nextLine(game)].join('\n') }
          }
          const plan = planOf(input)
          if (input.action === 'new_game') {
            const mode = input.mode ?? 'user'
            if (plan && mode !== 'agent')
              throw new MoveRefused('Moves need a game you control: new_game with mode "agent".')
            const game = await games.agentNewGame(chat, mode)
            const details = openBoard(chat)
            if (plan) return { ...afterMoves(await games.agentMoves(chat, plan), plan), details }
            return {
              content: [
                'A new game is on this chat’s board.',
                describeGame(game),
                '',
                nextLine(game),
              ].join('\n'),
              details,
            }
          }
          if (!plan)
            throw new MoveRefused(
              'Name the moves: "prefer", an order such as ["down","left","right","up"], or an exact "moves" list.',
            )
          return afterMoves(await games.agentMoves(chat, plan), plan)
        } catch (error) {
          if (!(error instanceof MoveRefused)) throw error
          const game = chat ? await games.read(chat) : null
          const board = game
            ? `\n\n${[endLine(game), drawBoard(game)].filter(Boolean).join('\n')}`
            : ''
          return { content: `${error.message}${board}`, isError: true }
        }
      },
    }),
  ]
}
