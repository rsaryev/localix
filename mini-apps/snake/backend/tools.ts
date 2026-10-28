import {
  classifyByAction,
  type MiniAppContext,
  type ChatRef,
} from '@localixai/mini-app-sdk/backend'

import { describeGame } from '../shared/describe'
import { MoveRefused } from '../shared/game'
import { gameUri } from '../shared/resource'
import type { GameService } from './game-service'

/** Reading the board is a read; a new game changes only this chat's board — `session`. */
export const classifySnakeCall = classifyByAction({
  state: { effect: 'read' },
  new_game: { effect: 'session' },
})

/**
 * The chat agent's side of Snake — ONE tool, `snake`, that never steers: the person or the
 * decision model does. `state` reads the board so the agent can talk about it; `new_game` sets up
 * this chat's board and offers it. Every action acts on the board of the chat the call RUNS in.
 */
export function createGameTools(ctx: MiniAppContext, games: GameService) {
  const chatOf = (context: { session?: { id: string } } | undefined): ChatRef => {
    const sessionId = context?.session?.id
    if (!sessionId) throw new MoveRefused('Snake is played in a chat; this call has none.')
    return { userId: ctx.userId, sessionId }
  }
  return [
    ctx.defineTool({
      name: 'snake',
      label: 'Snake',
      activeVerb: 'Reading the Snake board',
      description:
        'This chat’s Snake board. You never steer: the user plays with the arrow keys, or a decision model plays. "state" reads the board; "new_game" sets up a fresh board for the user and offers it.',
      inputSchema: ctx.z.object({
        action: ctx.z.enum(['state', 'new_game']).describe('What to do on this chat’s board.'),
      }),
      executionMode: 'sequential',
      mutates: true,
      classify: classifySnakeCall,
      permissionPaths: () => [],
      async execute(_toolCallId, input, _signal, _onUpdate, context) {
        try {
          const chat = chatOf(context)
          if (input.action === 'state') return { content: describeGame(await games.read(chat)) }
          const game = await games.agentNewGame(chat)
          return {
            content: [
              'A new game is on this chat’s board. The user starts it with an arrow key, or hands it to the decision model.',
              '',
              describeGame(game),
            ].join('\n'),
            details: ctx.ui.offer({
              uri: gameUri(chat.sessionId),
              label: 'Open Snake',
              description: 'This chat’s game',
            }),
          }
        } catch (error) {
          if (!(error instanceof MoveRefused)) throw error
          return { content: error.message, isError: true }
        }
      },
    }),
  ]
}
