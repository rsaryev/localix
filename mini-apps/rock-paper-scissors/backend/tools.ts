import { classifyByAction, type MiniAppContext } from '@localixai/mini-app-sdk/backend'

import { describeForAgent, recordLine, resultLine, roundLine } from '../shared/describe'
import { MoveRefused, viewFor, type Game, type Move, type Player } from '../shared/game'
import { gameUri } from '../shared/resource'
import type { ChatRef } from './ask-agent'
import type { GameService } from './game-service'

/** Reading the table is a read; every other action changes only this chat's game — `session`. */
export const classifyRockPaperScissorsCall = classifyByAction({
  state: { effect: 'read' },
  play: { effect: 'session' },
  next_round: { effect: 'session' },
})

/**
 * The agent's side of the game — ONE tool, `rock_paper_scissors`, whose `action` says what it does.
 *
 * The tool's `move` argument is SEALED (`presentation.sealed`): the host replaces it before the call
 * is stored or streamed, so the user's chat shows that the agent played, never what — the value
 * exists only in this run and in the table's own sealed record. For the same reason no result
 * ever names the agent's move before the round reveals it: a result is shown to the user too.
 *
 * Every action acts on the table of the chat the call RUNS in. A move that answers the table's wake
 * and leaves the round waiting for the user ends the turn (`terminate`): there is nothing to say
 * that would not risk the move. A move that completes the round asks for one short line about it.
 */

/** What the agent is asked when its move reveals a round. */
export const ROUND_OVER_ASK =
  'The round is revealed on the table. React to it in one short line and offer the next round. If the rounds so far showed you a habit of this user’s you did not know, keep it in your memory — update your one note on Rock Paper Scissors rather than adding another.'

type Result = { content: string; isError?: boolean; terminate?: boolean; details?: unknown }

/** The table a tool call acts on: the chat the call runs in. */
function chatOf(ctx: MiniAppContext, context: { session?: { id: string } } | undefined): ChatRef {
  const sessionId = context?.session?.id
  if (!sessionId)
    throw new MoveRefused('Rock Paper Scissors is played in a chat; this call has none.')
  return { userId: ctx.userId, sessionId }
}

function afterMove(game: Game, answered: boolean): Result {
  const view = viewFor(game, 'agent')
  if (view.round.outcome !== null)
    return {
      content: [resultLine(view.round), recordLine(view.record), '', ROUND_OVER_ASK]
        .filter((line) => line !== null)
        .join('\n'),
    }
  return {
    content: `${roundLine(view)} Do not name or hint at your move until the round is revealed.`,
    ...(answered ? { terminate: true } : {}),
  }
}

export function createGameTools(ctx: MiniAppContext, games: GameService) {
  const actions = {
    async play(chat: ChatRef, move: Move | undefined): Promise<Result> {
      if (!move) throw new MoveRefused('Name your move: `move`, one of rock, paper or scissors.')
      const { game, answered } = await games.agentMove(chat, move)
      return afterMove(game, answered)
    },
    async state(chat: ChatRef): Promise<Result> {
      return { content: describeForAgent(viewFor(await games.read(chat), 'agent')) }
    },
    async next_round(chat: ChatRef, first: Player): Promise<Result> {
      const game = await games.agentNextRound(chat, first)
      return {
        content: [
          `Round ${game.round.number} is on this chat’s table.`,
          game.opponent === 'decision'
            ? 'The decision model plays the other side at this table, so the user opens and you do not play.'
            : first === 'agent'
              ? 'You open: call rock_paper_scissors with action "play" now.'
              : 'The user opens; the table wakes you after they have chosen.',
          recordLine(game.record),
        ]
          .filter((line) => line !== null)
          .join('\n'),
        details: ctx.ui.offer({
          uri: gameUri(chat.sessionId),
          label: 'Open Rock Paper Scissors',
          description: 'This chat’s table',
        }),
      }
    },
  }

  return [
    ctx.defineTool({
      name: 'rock_paper_scissors',
      label: 'Rock Paper Scissors',
      activeVerb: 'Playing Rock Paper Scissors',
      description:
        'Play Rock Paper Scissors with the user on this chat’s table. "play" seals your move — the user sees only its digest until they have chosen, and the chat shows the move as [sealed]. "state" reads the table; "next_round" starts a round.',
      inputSchema: ctx.z.object({
        action: ctx.z
          .enum(['play', 'state', 'next_round'])
          .describe('What to do at this chat’s table.'),
        move: ctx.z
          .enum(['rock', 'paper', 'scissors'])
          .optional()
          .describe('For "play": your move. Sealed — never repeat it in text.'),
        first: ctx.z
          .enum(['user', 'agent'])
          .optional()
          .describe('For "next_round": who opens it (default the user).'),
      }),
      presentation: { sealed: { input: ['move'] } },
      executionMode: 'sequential',
      mutates: true,
      classify: classifyRockPaperScissorsCall,
      permissionPaths: () => [],
      async execute(_toolCallId, input, _signal, _onUpdate, context) {
        let chat: ChatRef | null = null
        try {
          chat = chatOf(ctx, context)
          switch (input.action) {
            case 'play':
              return await actions.play(chat, input.move)
            case 'state':
              return await actions.state(chat)
            case 'next_round':
              return await actions.next_round(chat, input.first === 'agent' ? 'agent' : 'you')
          }
        } catch (error) {
          if (!(error instanceof MoveRefused)) throw error
          const table = chat
            ? `\n\n${describeForAgent(viewFor(await games.read(chat), 'agent'))}`
            : ''
          return { content: `${error.message}${table}`, isError: true }
        }
      },
    }),
  ]
}
