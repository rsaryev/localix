import {
  askDecisionForTurn,
  type DecisionAsk,
  type DecisionHost,
} from '@localixai/mini-app-sdk/backend'

import { positionOfGame, type AgentWait, type Game } from '../shared/game'
import { other, type Play } from '../shared/position'
import type { ChatRef } from './ask-agent'

/**
 * HOW THE BOARD ASKS THE DECISION MODEL FOR ITS MOVE — when the table's opponent is `decision`.
 *
 * The mini app asks the host's decision model itself (`ctx.host.decisions`): one `choice` question
 * whose options are the legal moves in SAN — the notation the tool takes — each described in
 * plain words. No chat is woken and nothing is written in it; the spend is recorded against the
 * chat the board belongs to.
 *
 * What code can see for certain — the FEN, whether the side to move is in check, which moves
 * mate, give check or capture and what — goes into the state, so the model weighs facts rather
 * than working them out; the pick is still the model's. Every option is a legal move, so the
 * leading option is played whatever its probability (`askDecisionForTurn` refuses anything else).
 */

export const DECISION_PURPOSE = 'move'

const PIECE: { [type: string]: string } = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

/** "Knight g1 to f3, captures a pawn, gives check" — one legal move in words. */
export function describePlay(play: Play, mover: string | undefined): string {
  if (play.san.startsWith('O-O-O')) return 'Castle queenside'
  if (play.san.startsWith('O-O')) return 'Castle kingside'
  return [
    `${(PIECE[mover ?? ''] ?? 'piece').replace(/^./, (c) => c.toUpperCase())} ${play.from} to ${play.to}`,
    play.captured ? `captures a ${PIECE[play.captured] ?? 'piece'}` : null,
    play.promotion ? `promotes to a ${PIECE[play.promotion]}` : null,
    play.san.includes('#') ? 'checkmate' : play.san.includes('+') ? 'gives check' : null,
  ]
    .filter(Boolean)
    .join(', ')
}

/** The position from the decision model's side, and the one question: which legal move. */
export function moveAsk(game: Game): DecisionAsk {
  const { fen, inCheck, legal, cells } = positionOfGame(game)
  const side = other(game.you)
  const pieceOn = new Map(cells.map((cell) => [cell.square, cell.piece?.type]))
  const criteria = Object.fromEntries(
    legal.map((play) => [play.san, describePlay(play, pieceOn.get(play.from))]),
  )
  return {
    state: {
      game: 'chess',
      you_play: side,
      fen,
      you_are_in_check: inCheck,
      moves_so_far: game.moves.map((move) => move.san),
      checkmating_moves: legal.filter((play) => play.san.includes('#')).map((play) => play.san),
      checking_moves: legal.filter((play) => play.san.includes('+')).map((play) => play.san),
      captures: legal
        .filter((play) => play.captured)
        .map((play) => `${play.san} takes a ${PIECE[play.captured!] ?? 'piece'}`),
    },
    questions: {
      move: {
        type: 'choice',
        instructions: `Which legal move is the best for ${side}? Mate if you can; else win material or avoid losing it, keep your king safe, develop pieces and control the centre.`,
        criteria,
      },
    },
  }
}

/** The decision model's move in SAN, or the wait that says why there is none. */
export async function askDecision(
  decisions: DecisionHost | undefined,
  chat: ChatRef,
  game: Game,
  now: string,
): Promise<{ move: string } | { waiting: AgentWait }> {
  const turn = { ask: moveAsk(game), question: 'move', purpose: DECISION_PURPOSE }
  const answered = await askDecisionForTurn(decisions, chat, turn, now)
  return 'answer' in answered ? { move: answered.answer.choice } : answered
}
