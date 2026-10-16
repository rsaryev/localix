import type { PlayerView, GameRecord, Shot } from '../../shared/game'
import { cellName } from '../../shared/rules'

/**
 * The game in the PERSON's words — the view's headline and what a screen reader announces.
 *
 * `shared/describe.ts` speaks from the agent's seat ("Your shot."); the view speaks to whoever is
 * looking at the board ("Your shot", "The agent won"). Pure, so every state the board can be in
 * has a sentence a test can read.
 */

const RESULT = { miss: 'missed', hit: 'hit a ship', sunk: 'sank a ship' } as const

/** "The agent fired at E5 and hit a ship." */
export const shotSentence = (shot: Shot) =>
  `${shot.by === 'you' ? 'You' : 'The agent'} fired at ${cellName(shot.cell)} and ${RESULT[shot.result]}.`

/** The headline beside the boards. */
export function headline(view: PlayerView): string {
  if (view.status === 'won') return 'You won'
  if (view.status === 'lost') return 'The agent won'
  if (view.turn === 'you') return 'Your shot'
  if (view.waiting?.status === 'unreachable') return 'The agent could not be reached'
  return 'The agent is aiming'
}

/** What a screen reader hears when the board changes: the last shot, then what it means now. */
export function announcement(view: PlayerView): string {
  const last = view.shots.at(-1)
  return [last ? shotSentence(last) : 'New game.', `${headline(view)}.`].join(' ')
}

/** Who fires first next game — the side that did not this time. */
export const nextOpener = (view: PlayerView) =>
  view.first === 'agent' ? 'you fire first' : 'the agent fires first'

/** " · Score 2–1" — the table's running score, empty before the first game ends. */
export const scoreLine = (record: GameRecord) =>
  record.won + record.lost === 0 ? '' : ` · Score ${record.won}–${record.lost}`

/** "12s", "1m 05s" — how long the agent has been thinking. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
