import { promises as fs } from 'node:fs'
import path from 'node:path'
import { captureRoot, verifyDemoRuntime } from './runtime.mjs'
import * as chess from '../../plugins/chess/shared/game.ts'
import * as checkers from '../../plugins/checkers/shared/game.ts'
import * as tic from '../../plugins/tic-tac-toe/shared/game.ts'
import * as battleship from '../../plugins/battleship/shared/game.ts'
import * as puzzle from '../../plugins/game-2048/shared/game.ts'
import { placeFleet } from '../../plugins/battleship/shared/rules.ts'

/** Legal illustrative positions; no agent tool, provider call or host wake is executed. */
export async function seedGames() {
  await verifyDemoRuntime()
  const now = '2026-10-08T00:00:00.000Z'
  const identity = (id) => ({ id: `capture-${id}`, now })
  let game = chess.newGame({ ...identity('chess'), you: 'white' })
  for (const [i, move] of ['e2e4', 'e7e5', 'g1f3', 'b8c6'].entries())
    game = chess.applyMove(game, move, i % 2 ? 'agent' : 'you', now)
  const games = { chess: chess.gameSchema.parse(game) }
  game = checkers.newGame({ ...identity('checkers'), you: 'white' })
  for (let i = 0; i < 4; i++) {
    const move = checkers.movesNow(game)[0]
    game = checkers.applyMove(game, [move.from, ...move.path], i % 2 ? 'agent' : 'you', now)
  }
  games.checkers = checkers.gameSchema.parse(game)
  game = tic.newGame({ ...identity('tic-tac-toe'), first: 'X' })
  for (const [i, cell] of [0, 3, 1, 4].entries())
    game = tic.applyMove(game, cell, i % 2 ? 'agent' : 'you', now)
  games['tic-tac-toe'] = tic.gameSchema.parse(game)
  let randomState = 42
  const random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0
    return randomState / 4294967296
  }
  game = battleship.newGame({
    ...identity('battleship'),
    first: 'you',
    fleets: { you: placeFleet(random), agent: placeFleet(random) },
  })
  // Scripted legal turns show hits, misses and both boards. The final UI hit sinks a ship
  // and retains the human turn, so no model is woken.
  const water = (fleet, excluded) =>
    Array.from({ length: 100 }, (_, cell) => cell).find(
      (cell) => !fleet.some((ship) => ship.cells.includes(cell)) && !excluded.includes(cell),
    )
  for (let round = 0; round < 3; round++) {
    for (const by of ['you', 'agent']) {
      const targetFleet = game.fleets[by === 'you' ? 'agent' : 'you']
      game = battleship.applyShot(game, by, targetFleet[0].cells[round], now)
      const misses = game.shots.filter((shot) => shot.by === by).map((shot) => shot.cell)
      game = battleship.applyShot(game, by, water(targetFleet, misses), now)
    }
  }
  games.battleship = battleship.gameSchema.parse(game)
  games['game-2048'] = puzzle.gameSchema.parse(
    puzzle.newGame({ ...identity('2048'), mode: 'user', random: () => 0 }),
  )
  const root = path.join(captureRoot, 'game-fixtures')
  await fs.mkdir(root, { recursive: true })
  for (const [name, value] of Object.entries(games))
    await fs.writeFile(path.join(root, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`)
}
