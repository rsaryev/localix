import {
  askDecisionForTurn,
  type DecisionAsk,
  type DecisionHost,
} from '@localixai/mini-app-sdk/backend'

import { shotsBy, viewFor, type AgentWait, type Game } from '../shared/game'
import { suggestedCells, targetGrid } from '../shared/describe'
import { FLEET, SIZE, cellAt, cellName, colOf, knownCells, rowOf, shipAt } from '../shared/rules'
import type { ChatRef } from './ask-agent'

/**
 * HOW THE BOARD ASKS THE DECISION MODEL FOR ITS SHOT — when the table's opponent is `decision`.
 *
 * The mini app asks the host's decision model itself (`ctx.host.decisions`): one `choice` question
 * whose options are the cells the agent's side has not learned yet. No chat is woken and nothing is
 * written in it; the spend is recorded against the chat the board belongs to.
 *
 * Everything the question reads is built from the AGENT's view (`viewFor(game, 'agent')`), the same
 * projection the woken agent reads, so the user's fleet cannot reach the model. What code can see
 * for certain — the cells beside a hit ship still afloat, and the two ends of a line of hits — is
 * computed here and put in the state, so the model weighs a fact rather than working it out; the
 * pick is still the model's. Every option is a cell that can be fired at, so the leading option is
 * played whatever its probability (`askDecisionForTurn` refuses anything outside them).
 */

export const DECISION_PURPOSE = 'shot'

/**
 * Unknown cells at an end of a line of hits on a ship still afloat: beside a hit, with another hit
 * straight on the far side of it — the ship runs that way, so this is where it continues.
 */
function lineEnds(view: ReturnType<typeof viewFor>): number[] {
  const open = new Set(
    view.shots
      .filter((shot) => shot.by === 'agent' && shot.result === 'hit')
      .map((shot) => shot.cell)
      .filter((cell) => !shipAt(view.enemySeen, cell)),
  )
  const known = knownCells(view.enemySeen, shotsBy(view, 'agent'))
  const step = (cell: number, rows: number, cols: number) => {
    const row = rowOf(cell) + rows
    const col = colOf(cell) + cols
    return row < 0 || row >= SIZE || col < 0 || col >= SIZE ? null : row * SIZE + col
  }
  const ends = new Set<number>()
  for (const hit of open)
    for (const [rows, cols] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      const end = step(hit, rows, cols)
      const behind = step(hit, -rows, -cols)
      if (end !== null && behind !== null && open.has(behind) && !known.has(end)) ends.add(end)
    }
  return [...ends].sort((a, b) => a - b)
}

/** The agent side's picture of the user's waters, and the one question: which cell to fire at. */
export function shotAsk(game: Game): DecisionAsk {
  const view = viewFor(game, 'agent')
  const known = knownCells(view.enemySeen, shotsBy(view, 'agent'))
  const criteria = Object.fromEntries(
    Array.from({ length: SIZE * SIZE }, (_, cell) => cell)
      .filter((cell) => !known.has(cell))
      .map((cell) => [cellName(cell), `Cell ${cellName(cell)}`]),
  )
  const sunk = view.enemySeen.map((ship) => ship.cells.length)
  const afloat: number[] = [...FLEET].sort((a, b) => b - a)
  for (const length of sunk) afloat.splice(afloat.indexOf(length), 1)
  return {
    state: {
      game: 'battleship on a 10×10 grid, columns A–J, rows 1–10; ships are straight and never touch, even diagonally; a hit earns another shot',
      your_shots_at_the_opponent: targetGrid(view),
      legend: '. unknown, o water, x hit on a ship still afloat, # sunk ship',
      opponent_ships_afloat_by_length: afloat,
      cells_beside_an_afloat_hit: suggestedCells(view).map(cellName),
      cells_at_the_ends_of_a_line_of_hits: lineEnds(view).map(cellName),
    },
    questions: {
      shot: {
        type: 'choice',
        instructions:
          'Which unknown cell should you fire at next? Finish a hit ship first: fire at an end of a line of hits, else beside a single hit. Otherwise hunt where the largest ship still afloat fits, away from known water.',
        criteria,
      },
    },
  }
}

/** The decision model's shot: the cell (0–99), or the wait that says why there is none. */
export async function askDecision(
  decisions: DecisionHost | undefined,
  chat: ChatRef,
  game: Game,
  now: string,
): Promise<{ cell: number } | { waiting: AgentWait }> {
  const ask = shotAsk(game)
  const turn = { ask, question: 'shot', purpose: DECISION_PURPOSE }
  const answered = await askDecisionForTurn(decisions, chat, turn, now)
  if (!('answer' in answered)) return answered
  const cell = cellAt(answered.answer.choice)
  return cell === null
    ? {
        waiting: {
          since: now,
          status: 'unreachable',
          reason: 'The decision model could not answer.',
        },
      }
    : { cell }
}
