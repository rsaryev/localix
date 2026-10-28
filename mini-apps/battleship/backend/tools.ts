import { classifyByAction, type MiniAppContext } from '@localixai/mini-app-sdk/backend'

import {
  describeGame,
  recordLine,
  shotLine,
  statusLine,
  suggestedCells,
  targetGrid,
} from '../shared/describe'
import { ShotRefused, owesAgentShot, viewFor, type Game } from '../shared/game'
import { gameUri } from '../shared/resource'
import { cellAt, cellName } from '../shared/rules'
import type { ChatRef } from './ask-agent'
import type { GameService } from './game-service'

/**
 * Without a classifier the tool's static `mutates: true` read as `external`, so a read-only plan
 * session refused even `state`. Reading the agent's side is a read; firing and starting a game
 * change only this chat's game, which is deleted with the chat — `session`. A batch answers its
 * widest step.
 */
export const classifyBattleshipCall = classifyByAction({
  state: { effect: 'read' },
  fire: { effect: 'session' },
  new_game: { effect: 'session' },
})

/**
 * The agent's side of the game — ONE tool, `battleship`, whose `action` says what it does: fire,
 * read its side of the game, start a game. One tool rather than three, because every tool's schema
 * rides in every request of every run the mini app is loaded for; three tools cost three schemas
 * and three names the model has to choose between, for what is one conversation with one board.
 * None of the actions wakes anyone: the agent calling the tool is already the turn.
 *
 * Every action acts on the board of the chat the call RUNS in — the session the host names in the
 * call's context — and every result is built from the AGENT's view (`viewFor(game, 'agent')`), so
 * no result can carry the user's fleet.
 *
 * A hit earns another shot, so a hit NEVER ends the turn: the result says to fire again. A miss
 * that answers the board's wake ENDS it (`terminate`) while the game goes on — the board shows the
 * shot, and a chat line repeating it would be a second model call that told the user nothing. The
 * last shot of a game, and a shot the user asked for in chat, keep the reply.
 */

/**
 * What the agent is asked when a game ends. Lessons belong in the host's memory, not in this chat:
 * the chat (and its board) may be deleted, and what the agent learned about how this person plays
 * should outlive it. One note per game, updated — a note per game played would bury the rest.
 */
export const GAME_OVER_ASK =
  'The game is over. Tell the user in one short line, and offer another game. If this game showed you something about how this user plays that you did not know, keep it in your memory — update your one note on Battleship rather than adding another.'

type Result = { content: string; isError?: boolean; terminate?: boolean; details?: unknown }

function afterShot(game: Game, ends: boolean): string {
  const view = viewFor(game, 'agent')
  const shot = game.shots.at(-1)!
  const said = `${shotLine(shot)} ${statusLine(view)}`
  if (ends) return said
  const next =
    game.status !== 'playing'
      ? [GAME_OVER_ASK, recordLine(game.record)].filter(Boolean).join(' ')
      : game.turn === 'agent'
        ? fireAgain(view)
        : 'The board wakes you when the user has fired.'
  return [said, '', targetGrid(view), '', next].join('\n')
}

/**
 * After a hit, name where to aim — the unknown cells beside a ship still afloat. Without it, the
 * agent picked cells the grid already marked as water (the border of a sunk ship) and was refused:
 * three refusals in one real game, each a model call re-reading the whole board.
 */
function fireAgain(view: ReturnType<typeof viewFor>): string {
  const aim = suggestedCells(view)
  return aim.length > 0
    ? `A hit earns another shot: fire again now, beside the hit — ${aim.map(cellName).join(', ')}.`
    : 'A hit earns another shot: fire again now, at an unknown cell (a ".").'
}

/** The table a tool call acts on: the chat the call runs in. */
function chatOf(ctx: MiniAppContext, context: { session?: { id: string } } | undefined): ChatRef {
  const sessionId = context?.session?.id
  if (!sessionId) throw new ShotRefused('Battleship is played in a chat; this call has none.')
  return { userId: ctx.userId, sessionId }
}

export function createGameTools(ctx: MiniAppContext, games: GameService) {
  const stepSchema = ctx.z.object({
    action: ctx.z.enum(['fire', 'state', 'new_game']),
    cell: ctx.z.string().min(2).max(4).optional(),
    first: ctx.z.enum(['user', 'agent']).optional(),
  })
  const actions = {
    async fire(chat: ChatRef, named: string | undefined): Promise<Result> {
      if (!named) throw new ShotRefused('Name the cell: `cell`, an unknown one from A1 to J10.')
      const cell = cellAt(named)
      if (cell === null) throw new ShotRefused(`"${named}" is not a cell — use A1 to J10.`)
      const { game, answered } = await games.agentShot(chat, cell)
      // Only a shot that passed the turn ends it; after a hit the agent fires again.
      const ends = answered && game.status === 'playing' && game.turn === 'you'
      return { content: afterShot(game, ends), ...(ends ? { terminate: true } : {}) }
    },
    async state(chat: ChatRef): Promise<Result> {
      return { content: describeGame(viewFor(await games.read(chat), 'agent')) }
    },
    async new_game(chat: ChatRef, first: 'user' | 'agent'): Promise<Result> {
      const game = await games.agentNewGame(chat, first === 'agent' ? 'agent' : 'you')
      return {
        content: [
          'A new game is on this chat’s board. Both fleets are placed.',
          game.opponent === 'decision'
            ? 'The decision model fires from your side at this table, so the user fires first and you do not fire.'
            : first === 'agent'
              ? 'You fire first: call battleship with action "fire" now.'
              : 'The user fires first; the board wakes you when it is your shot.',
          recordLine(game.record),
        ]
          .filter((line) => line !== null)
          .join('\n'),
        details: ctx.ui.offer({
          uri: gameUri(chat.sessionId),
          label: 'Open Battleship',
          description: 'This chat’s board',
        }),
      }
    },
  }

  return [
    ctx.defineTool({
      name: 'battleship',
      label: 'Battleship',
      activeVerb: 'Playing Battleship',
      description:
        'Play Battleship with the user on this chat’s board. Use one action or up to 16 sequential actions. Hits can continue in a batch; a miss stops it when the turn passes to the user. "state" reads your side; "new_game" starts a game. The user’s fleet is hidden.',
      inputSchema: ctx.z.object({
        action: ctx.z
          .enum(['fire', 'state', 'new_game'])
          .optional()
          .describe('What to do on this chat’s board.'),
        cell: ctx.z
          .string()
          .min(2)
          .max(4)
          .optional()
          .describe('For "fire": the cell, A1 to J10 — "A1" top left, "J10" bottom right.'),
        first: ctx.z
          .enum(['user', 'agent'])
          .optional()
          .describe('For "new_game": who fires first (default the user).'),
        actions: ctx.z.array(stepSchema).min(1).max(16).optional().describe('Actions in order.'),
      }),
      executionMode: 'sequential',
      mutates: true,
      classify: classifyBattleshipCall,
      permissionPaths: () => [],
      async execute(_toolCallId, input, _signal, _onUpdate, context) {
        let chat: ChatRef | null = null
        try {
          chat = chatOf(ctx, context)
          if (input.actions && input.action)
            throw new ShotRefused('Use either action or actions, not both.')
          if (!input.actions && !input.action)
            throw new ShotRefused('Choose an action or provide actions.')
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
                case 'fire':
                  result = await actions.fire(chat, step.cell)
                  break
                case 'state':
                  result = await actions.state(chat)
                  break
                case 'new_game':
                  result = await actions.new_game(chat, step.first ?? 'user')
                  break
              }
            } catch (error) {
              if (!(error instanceof ShotRefused) || !input.actions) throw error
              // The first step refused is a call that did nothing — the agent's to fix. A later one
              // was planned before the earlier shots landed: a shot that SINKS a ship makes its
              // border known water, so the next planned cell is refused. What the earlier shots did
              // stands, and failing the whole call dropped their hits and sinks from the report.
              if (completed === 0)
                throw new ShotRefused(`Action ${index + 1} failed: ${error.message}`)
              refused = ` Action ${index + 1} was not played: ${error.message}`
              break
            }
            completed++
            if (result.details) details = result.details
            // A new game the user opens hands the turn over as surely as a miss does.
            if (
              result.terminate ||
              (input.actions && step.action !== 'state' && !owesAgentShot(await games.read(chat)))
            )
              break
          }
          return {
            ...result!,
            content: `${input.actions ? `${completed} of ${steps.length} actions completed.${refused}\n` : ''}${result!.content}`,
            ...(details ? { details } : {}),
          }
        } catch (error) {
          if (!(error instanceof ShotRefused)) throw error
          const board = chat ? `\n\n${describeGame(viewFor(await games.read(chat), 'agent'))}` : ''
          return { content: `${error.message}${board}`, isError: true }
        }
      },
    }),
  ]
}
