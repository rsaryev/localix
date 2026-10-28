import { classifyByAction, type MiniAppContext } from '@localixai/mini-app-sdk/backend'

import {
  describeGame,
  drawBoard,
  lastMoveLine,
  legalLine,
  recordLine,
  statusLine,
} from '../shared/describe'
import { MoveRefused, owesAgentMove, type Game } from '../shared/game'
import { parseSquares } from '../shared/notation'
import { gameUri } from '../shared/resource'
import type { ChatRef } from './ask-agent'
import type { GameService } from './game-service'

/**
 * Without a classifier the tool's static `mutates: true` read as `external`, so a read-only plan
 * session refused even `state`. Reading the board is a read; every other action changes only
 * this chat's game, which is deleted with the chat — `session`. A batch answers its widest step.
 */
export const classifyCheckersCall = classifyByAction({
  state: { effect: 'read' },
  move: { effect: 'session' },
  new_game: { effect: 'session' },
  resign: { effect: 'session' },
})

/**
 * The agent's side of the game — ONE tool, `checkers`, whose `action` says what it does: play a
 * move, read the board, start a game, resign. One tool rather than four, because every tool's
 * schema rides in every request of every run the mini app is loaded for; four tools cost four
 * schemas and four names the model has to choose between, for what is one conversation with one
 * board. None of the actions wakes anyone: the agent calling the tool is already the turn.
 *
 * Every action acts on the board of the chat the call RUNS in — the session the host names in the
 * call's context — so an agent in one chat can never touch another chat's board.
 *
 * A move that answers the board's wake ENDS the turn (`terminate`) while the game goes on: the
 * board shows the move, and a chat line repeating it would be a second model call per move that
 * told the user nothing the board did not. The last move of a game, a move the user asked for in
 * chat, and a resignation keep the reply — there is something to say. A refused move never ends
 * the turn: the agent has to act on the board as it now is.
 */

/**
 * What the agent is asked when a game ends. Lessons belong in the host's memory, not in this chat:
 * the chat (and its board) may be deleted, and what the agent learned about how this person plays
 * should outlive it. One note per game, updated — a note per game played would bury the rest.
 */
export const GAME_OVER_ASK =
  'The game is over. Tell the user in one short line, and offer another game. If this game showed you something about how this user plays that you did not know, keep it in your memory — update your one note on Checkers rather than adding another.'

type Result = { content: string; isError?: boolean; terminate?: boolean; details?: unknown }

const gameOver = (game: Game) => [GAME_OVER_ASK, recordLine(game.record)].filter(Boolean).join(' ')

function afterMove(game: Game, ends: boolean): string {
  const said = [lastMoveLine(game), statusLine(game)].filter(Boolean).join(' ')
  if (ends) return `${said}\n\n${drawBoard(game)}`
  const next =
    game.status === 'playing' ? 'The board wakes you when the user has moved.' : gameOver(game)
  return [said, '', drawBoard(game), '', next].join('\n')
}

/** The table a tool call acts on: the chat the call runs in. */
function chatOf(ctx: MiniAppContext, context: { session?: { id: string } } | undefined): ChatRef {
  const sessionId = context?.session?.id
  if (!sessionId) throw new MoveRefused('Checkers is played in a chat; this call has none.')
  return { userId: ctx.userId, sessionId }
}

export function createGameTools(ctx: MiniAppContext, games: GameService) {
  const stepSchema = ctx.z.object({
    action: ctx.z.enum(['move', 'state', 'new_game', 'resign']),
    move: ctx.z.string().min(5).max(60).optional(),
    userPlays: ctx.z.enum(['white', 'black']).optional(),
    reason: ctx.z.string().max(200).optional(),
  })
  const actions = {
    async move(chat: ChatRef, move: string | undefined): Promise<Result> {
      if (!move) throw new MoveRefused('Name the move: `move` with one of the legal moves.')
      const { game, answered } = await games.agentMove(chat, parseSquares(move))
      const ends = answered && game.status === 'playing'
      return { content: afterMove(game, ends), ...(ends ? { terminate: true } : {}) }
    },
    async state(chat: ChatRef): Promise<Result> {
      return { content: describeGame(await games.read(chat)) }
    },
    async new_game(chat: ChatRef, userPlays: 'white' | 'black'): Promise<Result> {
      const game = await games.agentNewGame(chat, userPlays)
      const decision = game.opponent === 'decision'
      const agentFirst = !decision && userPlays === 'black'
      return {
        content: [
          'A new game is on this chat’s board.',
          decision
            ? 'The decision model plays the other colour at this table, so the user plays white and moves first, and you do not move.'
            : agentFirst
              ? 'You play white and move first: call checkers with action "move" now.'
              : 'The user plays white and moves first; the board wakes you after their move.',
          recordLine(game.record),
          '',
          drawBoard(game),
          ...(agentFirst ? ['', legalLine(game)] : []),
        ]
          .filter((line) => line !== null)
          .join('\n'),
        details: ctx.ui.offer({
          uri: gameUri(chat.sessionId),
          label: 'Open Checkers',
          description: 'This chat’s board',
        }),
      }
    },
    async resign(chat: ChatRef, reason: string | undefined): Promise<Result> {
      const game = await games.agentResign(chat)
      return {
        content: [
          `You resigned${reason ? ` — ${reason}` : ''}. The user won.`,
          '',
          gameOver(game),
        ].join('\n'),
      }
    },
  }

  return [
    ctx.defineTool({
      name: 'checkers',
      label: 'Checkers',
      activeVerb: 'Playing checkers',
      description:
        'Play checkers (Russian draughts) with the user on this chat’s board. Use one action or up to 16 sequential actions. A move stops the batch when the turn passes to the user. "state" reads the board; "new_game" starts a game; "resign" gives up.',
      inputSchema: ctx.z.object({
        action: ctx.z
          .enum(['move', 'state', 'new_game', 'resign'])
          .optional()
          .describe('What to do on this chat’s board.'),
        move: ctx.z
          .string()
          .min(5)
          .max(60)
          .optional()
          .describe(
            'For "move": one of the legal moves as listed — "c3-d4", or a capture "c3:e5:g3".',
          ),
        userPlays: ctx.z
          .enum(['white', 'black'])
          .optional()
          .describe('For "new_game": the user’s colour (default white); you play the other.'),
        reason: ctx.z
          .string()
          .max(200)
          .optional()
          .describe('For "resign": one short sentence on why the game is lost.'),
        actions: ctx.z.array(stepSchema).min(1).max(16).optional().describe('Actions in order.'),
      }),
      executionMode: 'sequential',
      mutates: true,
      classify: classifyCheckersCall,
      permissionPaths: () => [],
      async execute(_toolCallId, input, _signal, _onUpdate, context) {
        let chat: ChatRef | null = null
        try {
          chat = chatOf(ctx, context)
          if (input.actions && input.action)
            throw new MoveRefused('Use either action or actions, not both.')
          if (!input.actions && !input.action)
            throw new MoveRefused('Choose an action or provide actions.')
          const steps = input.actions ?? [
            {
              action: input.action!,
              move: input.move,
              userPlays: input.userPlays,
              reason: input.reason,
            },
          ]
          let result: Result | undefined
          let details: unknown
          let completed = 0
          let refused = ''
          for (const [index, step] of steps.entries()) {
            try {
              switch (step.action) {
                case 'move':
                  result = await actions.move(chat, step.move)
                  break
                case 'state':
                  result = await actions.state(chat)
                  break
                case 'new_game':
                  result = await actions.new_game(chat, step.userPlays ?? 'white')
                  break
                case 'resign':
                  result = await actions.resign(chat, step.reason)
                  break
              }
            } catch (error) {
              if (!(error instanceof MoveRefused) || !input.actions) throw error
              // The first step refused is a call that did nothing — the agent's to fix. A later one
              // was planned before the earlier steps played out, and what those did stands: failing
              // the whole call dropped their report (and a new game's board link) for good.
              if (completed === 0)
                throw new MoveRefused(`Action ${index + 1} failed: ${error.message}`)
              refused = ` Action ${index + 1} was not played: ${error.message}`
              break
            }
            completed++
            if (result.details) details = result.details
            // A new game the user opens hands the turn over as surely as a move does.
            if (
              result.terminate ||
              (input.actions && step.action === 'resign') ||
              (input.actions && step.action !== 'state' && !owesAgentMove(await games.read(chat)))
            )
              break
          }
          return {
            ...result!,
            content: `${input.actions ? `${completed} of ${steps.length} actions completed.${refused}\n` : ''}${result!.content}`,
            ...(details ? { details } : {}),
          }
        } catch (error) {
          if (!(error instanceof MoveRefused)) throw error
          const board = chat ? `\n\n${describeGame(await games.read(chat))}` : ''
          return { content: `${error.message}${board}`, isError: true }
        }
      },
    }),
  ]
}
