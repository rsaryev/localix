import { classifyByAction, type MiniAppContext } from '@localixai/mini-app-sdk/backend'

import { describeGame, drawBoard, lastMoveLine, recordLine, statusLine } from '../shared/describe'
import { MoveRefused, owesAgentMove, type Game } from '../shared/game'
import { gameUri } from '../shared/resource'
import type { ChatRef } from './ask-agent'
import type { GameService } from './game-service'

/**
 * Without a classifier the tool's static `mutates: true` read as `external`, so a read-only plan
 * session refused even `state`. Reading the board is a read; every other action changes only
 * this chat's game, which is deleted with the chat — `session`. A batch answers its widest step.
 */
export const classifyTicTacToeCall = classifyByAction({
  state: { effect: 'read' },
  move: { effect: 'session' },
  new_game: { effect: 'session' },
})

/**
 * The agent's side of the game — ONE tool, `tic_tac_toe`, whose `action` says what it does: play
 * O, read the board, start a game. One tool rather than three, because every tool's schema rides
 * in every request of every run the mini app is loaded for; three tools cost three schemas and
 * three names the model has to choose between, for what is one conversation with one board. None of
 * the actions wakes anyone: the agent calling the tool is already the turn.
 *
 * Every action acts on the board of the chat the call RUNS in — the session the host names in the
 * call's context — so an agent in one chat can never touch another chat's board.
 *
 * A move that answers the board's wake ENDS the turn (`terminate`) while the game goes on: the
 * board shows the move, and a chat line repeating it was a second model call per move that told
 * the user nothing the board did not. The last move of a game, and a move the user asked for in
 * chat, keep the reply — there is something to say. A refused move never ends the turn: the agent
 * has to act on the board as it now is.
 */

/**
 * What the agent is asked when a game ends. Lessons belong in the host's memory, not in this chat:
 * the chat (and its board) may be deleted, and what the agent learned about how this person plays
 * should outlive it. One note per game, updated — a note per game played would bury the rest.
 */
export const GAME_OVER_ASK =
  'The game is over. Tell the user in one short line, and offer another game. If this game showed you something about how this user plays that you did not know, keep it in your memory — update your one note on Tic-Tac-Toe rather than adding another.'

type Result = { content: string; isError?: boolean; terminate?: boolean; details?: unknown }

function afterMove(game: Game, ends: boolean): string {
  const said = [lastMoveLine(game), statusLine(game)].filter(Boolean).join(' ')
  if (ends) return `${said}\n\n${drawBoard(game)}`
  const next =
    game.status === 'playing'
      ? 'The board wakes you when the user has moved.'
      : [GAME_OVER_ASK, recordLine(game.record)].filter(Boolean).join(' ')
  return [said, '', drawBoard(game), '', next].join('\n')
}

/** The table a tool call acts on: the chat the call runs in. */
function chatOf(ctx: MiniAppContext, context: { session?: { id: string } } | undefined): ChatRef {
  const sessionId = context?.session?.id
  if (!sessionId) throw new MoveRefused('Tic-Tac-Toe is played in a chat; this call has none.')
  return { userId: ctx.userId, sessionId }
}

export function createGameTools(ctx: MiniAppContext, games: GameService) {
  const stepSchema = ctx.z.object({
    action: ctx.z.enum(['move', 'state', 'new_game']),
    cell: ctx.z.number().int().min(1).max(9).optional(),
    first: ctx.z.enum(['user', 'agent']).optional(),
  })
  const actions = {
    async move(chat: ChatRef, cell: number | undefined): Promise<Result> {
      if (cell === undefined) throw new MoveRefused('Name the cell: `cell`, one of the free 1–9.')
      const { game, answered } = await games.agentMove(chat, cell - 1)
      const ends = answered && game.status === 'playing'
      return { content: afterMove(game, ends), ...(ends ? { terminate: true } : {}) }
    },
    async state(chat: ChatRef): Promise<Result> {
      return { content: describeGame(await games.read(chat)) }
    },
    async new_game(chat: ChatRef, first: 'user' | 'agent'): Promise<Result> {
      const game = await games.agentNewGame(chat, first === 'agent' ? 'O' : 'X')
      return {
        content: [
          'A new game is on this chat’s board.',
          game.opponent === 'decision'
            ? 'The decision model plays O at this table, so the user moves first and you do not move.'
            : first === 'agent'
              ? 'You move first: call tic_tac_toe with action "move" now.'
              : 'The user moves first; the board wakes you after their move.',
          recordLine(game.record),
          '',
          drawBoard(game),
        ]
          .filter((line) => line !== null)
          .join('\n'),
        details: ctx.ui.offer({
          uri: gameUri(chat.sessionId),
          label: 'Open Tic-Tac-Toe',
          description: 'This chat’s board',
        }),
      }
    },
  }

  return [
    ctx.defineTool({
      name: 'tic_tac_toe',
      label: 'Tic-Tac-Toe',
      activeVerb: 'Playing Tic-Tac-Toe',
      description:
        'Play Tic-Tac-Toe with the user on this chat’s board; you are O. Use one action or up to 16 sequential actions. A move stops the batch when the turn passes to the user. "state" reads the board; "new_game" starts a game.',
      inputSchema: ctx.z.object({
        action: ctx.z
          .enum(['move', 'state', 'new_game'])
          .optional()
          .describe('What to do on this chat’s board.'),
        cell: ctx.z
          .number()
          .int()
          .min(1)
          .max(9)
          .optional()
          .describe('For "move": the free cell, 1–9 — 1 top left, 5 centre, 9 bottom right.'),
        first: ctx.z
          .enum(['user', 'agent'])
          .optional()
          .describe(
            'For "new_game": who moves first (default the user). The user is X, you are O.',
          ),
        actions: ctx.z.array(stepSchema).min(1).max(16).optional().describe('Actions in order.'),
      }),
      executionMode: 'sequential',
      mutates: true,
      classify: classifyTicTacToeCall,
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
            { action: input.action!, cell: input.cell, first: input.first },
          ]
          let result: Result | undefined
          let details: unknown
          let completed = 0
          let refused = ''
          for (const [index, step] of steps.entries()) {
            try {
              switch (step.action) {
                case 'move':
                  result = await actions.move(chat, step.cell)
                  break
                case 'state':
                  result = await actions.state(chat)
                  break
                case 'new_game':
                  result = await actions.new_game(chat, step.first ?? 'user')
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
