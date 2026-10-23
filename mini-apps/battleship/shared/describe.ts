import { shotsBy, type PlayerView, type GameRecord, type Shot } from './game'
import { SIZE, cellName, knownCells, neighbours, shipAt, type Ship } from './rules'

/**
 * The game as TEXT for the agent — tool results, the wake that asks for its shot, and the context
 * the view publishes. It is built ONLY from a {@link PlayerView} for the agent's side, never from
 * the whole game, so the user's fleet cannot reach the agent: the type offers no field that holds
 * it. The one place a whole fleet appears is the agent's own.
 */

const COLUMNS = '   A B C D E F G H I J'

/** A 10×10 grid with row numbers, one symbol per cell. */
function grid(symbol: (cell: number) => string): string {
  const rows = Array.from({ length: SIZE }, (_, row) => {
    const cells = Array.from({ length: SIZE }, (_, col) => symbol(row * SIZE + col))
    return `${String(row + 1).padStart(2)} ${cells.join(' ')}`
  })
  return [COLUMNS, ...rows].join('\n')
}

/** The agent's hits on ships the user still has afloat, from each shot's recorded result. */
const agentOpenHits = (view: PlayerView) =>
  view.shots
    .filter((s) => s.by === 'agent' && s.result === 'hit')
    .map((s) => s.cell)
    .filter((cell) => !shipAt(view.enemySeen, cell))

/**
 * The agent's picture of the user's board: "." unknown, "o" water (a miss, or the border of a
 * sunk ship), "x" a hit on a ship still afloat, "#" a sunk ship. The hidden fleet is never
 * available here: a sunk ship comes from `enemySeen`, a hit from the shot's own recorded result.
 */
export function targetGrid(view: PlayerView): string {
  const seen = view.enemySeen
  const hits = new Set(agentOpenHits(view))
  const water = knownCells(seen, shotsBy(view, 'agent'))
  return grid((cell) => {
    if (shipAt(seen, cell)) return '#'
    if (hits.has(cell)) return 'x'
    return water.has(cell) ? 'o' : '.'
  })
}

/** The agent's own board: "S" a ship cell, "X" a ship cell hit, "o" a miss by the user. */
export function ownGrid(fleet: readonly Ship[], shotsAtIt: readonly number[]): string {
  const hit = new Set(shotsAtIt)
  return grid((cell) => {
    const ship = shipAt(fleet, cell)
    if (ship) return hit.has(cell) ? 'X' : 'S'
    return hit.has(cell) ? 'o' : '.'
  })
}

const who = (shot: Shot) => (shot.by === 'you' ? 'The user' : 'You')
const RESULT = { miss: 'missed', hit: 'hit a ship', sunk: 'sank a ship' } as const

/** "The user fired at E5 and missed." */
export const shotLine = (shot: Shot) =>
  `${who(shot)} fired at ${cellName(shot.cell)} and ${RESULT[shot.result]}.`

/** The shots since the agent last fired — what happened while it waited. */
export function sinceLastTurn(view: PlayerView): string[] {
  const lastOwn = view.shots.findLastIndex((shot) => shot.by === 'agent')
  return view.shots.slice(lastOwn + 1).map(shotLine)
}

/**
 * The running score at this table, from the agent's side — so a woken turn knows the history of
 * this chat's games without reading them back from a transcript that checkpoints may have folded.
 */
export function recordLine(record: GameRecord): string | null {
  if (record.won + record.lost === 0) return null
  return `Score at this table: you ${record.lost}, the user ${record.won}.`
}

/** One sentence: whose shot, or how the game ended. */
export function statusLine(view: PlayerView): string {
  if (view.status === 'won') return 'The user won — your whole fleet is sunk.'
  if (view.status === 'lost') return 'You won — the user’s whole fleet is sunk.'
  if (view.turn === 'you') return 'The user’s shot.'
  return view.opponent === 'decision' ? 'The decision model’s shot.' : 'Your shot.'
}

/**
 * Where to aim next: the unknown cells straight beside a hit on a ship still afloat (ships are
 * straight, so never diagonally). Empty when there is no such hit.
 */
export function suggestedCells(view: PlayerView): number[] {
  const hits = agentOpenHits(view)
  if (hits.length === 0) return []
  const known = knownCells(view.enemySeen, shotsBy(view, 'agent'))
  const orthogonal = (cell: number) =>
    neighbours(cell).filter(
      (near) => near % SIZE === cell % SIZE || Math.floor(near / SIZE) === Math.floor(cell / SIZE),
    )
  const candidates = new Set(hits.flatMap(orthogonal).filter((cell) => !known.has(cell)))
  return [...candidates].sort((a, b) => a - b)
}

/**
 * The board as the PERSON sees it, told to the agent — the message context published beside the
 * board. The person's view holds their fleet, which the agent must never read, so this names only
 * what both sides already know: the shots and their results, the score, whose turn it is.
 */
export function describeForChat(view: PlayerView): string {
  const tally = (by: Shot['by']) => {
    const shots = view.shots.filter((shot) => shot.by === by)
    const hits = shots.filter((shot) => shot.result !== 'miss').length
    return `${shots.length} shots, ${hits} hits, ${shots.filter((s) => s.result === 'sunk').length} ships sunk`
  }
  const status =
    view.status === 'won'
      ? 'The user won — your whole fleet is sunk.'
      : view.status === 'lost'
        ? 'You won — the user’s whole fleet is sunk.'
        : view.turn === 'you'
          ? 'The user’s shot.'
          : 'Your shot.'
  return [
    'Battleship — the user’s board, as they see it. Their fleet is hidden from you.',
    status,
    ...(recordLine(view.record) ? [recordLine(view.record)!] : []),
    `The user so far: ${tally('you')}. You so far: ${tally('agent')}.`,
    ...view.shots.slice(-3).map(shotLine),
  ].join('\n')
}

/** Everything the agent needs to act, from its own side's view only. */
export function describeGame(view: PlayerView): string {
  const suggested = suggestedCells(view)
  const shotsAtAgent = shotsBy(view, 'you')
  return [
    view.opponent === 'decision'
      ? 'Battleship — the decision model fires from your side against the user. You do not fire at this table; the user can switch the opponent back to you on the board.'
      : 'Battleship — you play against the user. Each side fires in turn; a hit earns another shot.',
    ...(recordLine(view.record) ? [recordLine(view.record)!] : []),
    ...sinceLastTurn(view),
    statusLine(view),
    '',
    'Your shots at the user’s board (. unknown, o water, x hit, # sunk):',
    targetGrid(view),
    '',
    'Your own fleet (S ship, X hit, o the user’s miss):',
    ownGrid(view.fleet, shotsAtAgent),
    ...(view.status === 'playing' && suggested.length > 0
      ? ['', `A ship is hit but afloat — aim beside it: ${suggested.map(cellName).join(', ')}.`]
      : []),
  ].join('\n')
}
