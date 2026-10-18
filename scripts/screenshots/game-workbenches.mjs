import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { api, captureRoot, databaseFile, fixtureFile, verifyDemoRuntime } from './runtime.mjs'
import { openTool } from './scenarios.mjs'

const titles = {
  'game-2048': '2048',
  chess: 'Chess',
  checkers: 'Checkers',
  battleship: 'Battleship',
  'tic-tac-toe': 'Tic-Tac-Toe',
  'rock-paper-scissors': 'Rock Paper Scissors',
}

export async function seedGames(fixture) {
  const seeds = await import('./game-fixtures.mjs')
  await seeds.seedGames(fixture)
}

async function resetGame(scenario) {
  await verifyDemoRuntime()
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  if (!fixture.platformSessionId) throw new Error('Seed the dedicated platform conversation first.')
  const value = JSON.parse(
    await fs.readFile(path.join(captureRoot, 'game-fixtures', `${scenario}.json`), 'utf8'),
  )
  const directory = path.join(
    `${databaseFile}.session-data`,
    encodeURIComponent(fixture.platformSessionId),
    scenario,
  )
  await fs.mkdir(directory, { recursive: true })
  const temporary = path.join(directory, 'capture-game.tmp')
  await fs.writeFile(temporary, JSON.stringify(value))
  await fs.rename(temporary, path.join(directory, 'game.json'))
  return { fixture, game: value }
}

const route = (scenario, fixture) =>
  `/${scenario}/game?sessionId=${encodeURIComponent(fixture.platformSessionId)}`

async function actAndRead(page, scenario, action) {
  const result = page.waitForResponse(
    (response) =>
      response.url().includes(`/${scenario}/game/`) && response.request().method() === 'POST',
  )
  await action()
  const response = await result
  expect(response.ok()).toBe(true)
  return response.json()
}

// Whether compressing this direction changes a line: no duplicated game result or score logic.
function movable(board, direction) {
  const vertical = direction === 'up' || direction === 'down'
  const reverse = direction === 'right' || direction === 'down'
  for (let line = 0; line < 4; line++) {
    let values = Array.from(
      { length: 4 },
      (_, cell) => board[vertical ? cell * 4 + line : line * 4 + cell],
    )
    if (reverse) values = values.reverse()
    let empty = false
    let previous = null
    for (const value of values) {
      if (!value) empty = true
      else {
        if (empty || previous === value) return true
        previous = value
      }
    }
  }
  return false
}

export async function composeGame(page, scenario) {
  if (!titles[scenario]) throw new Error(`Unknown game scenario: ${scenario}`)
  const { fixture, game: initial } = await resetGame(scenario)
  await openTool(page, titles[scenario])
  if (scenario === 'game-2048') {
    const board = page.getByRole('application', { name: /^2048 board/ })
    await expect(board).toBeVisible()
    let game = await api(route(scenario, fixture))
    expect(game.mode).toBe('user')
    for (let index = 0; index < 24; index++) {
      const directions = ['left', 'down', 'right', 'up']
      const preferred = [...directions.slice(index % 4), ...directions.slice(0, index % 4)]
      const direction = preferred.find((candidate) => movable(game.board, candidate))
      if (!direction) break
      await board.focus()
      game = await actAndRead(page, scenario, () =>
        board.press(`Arrow${direction[0].toUpperCase()}${direction.slice(1)}`),
      )
      const rows = Array.from(
        { length: 4 },
        (_, row) =>
          `Row ${row + 1}: ${game.board
            .slice(row * 4, row * 4 + 4)
            .map((value) => value || 'empty')
            .join(', ')}.`,
      )
      await expect(board).toHaveAttribute('aria-label', `2048 board. ${rows.join(' ')}`)
    }
  } else if (scenario === 'chess') {
    await page.getByRole('button', { name: 'f1: white bishop', exact: true }).click()
    await expect(page.locator('.chess-target')).not.toHaveCount(0)
  } else if (scenario === 'checkers') {
    await page.locator('.checkers-square[data-action="true"]').first().click()
    await expect(page.locator('.checkers-target')).not.toHaveCount(0)
  } else if (scenario === 'tic-tac-toe') {
    await actAndRead(page, scenario, () =>
      page.getByRole('button', { name: 'Cell 3, top right: empty', exact: true }).click(),
    )
    await expect(page.getByRole('heading', { name: 'You won', exact: true })).toBeVisible()
  } else if (scenario === 'rock-paper-scissors') {
    // The agent's sealed move is face down and its value never reached the browser.
    const before = await api(route(scenario, fixture))
    expect(before.round.theirs).toMatchObject({ revealed: false, owner: 'agent' })
    expect(JSON.stringify(before.round)).not.toContain('paper')
    await expect(page.getByRole('figure', { name: 'Agent: sealed', exact: true })).toBeVisible()
    await actAndRead(page, scenario, () =>
      page.getByRole('button', { name: 'Scissors', exact: true }).click(),
    )
    await expect(page.getByText('Digest checked', { exact: false })).toBeVisible()
  } else {
    const nextHit = initial.fleets.agent[0].cells[3]
    const cell = `${String.fromCharCode(65 + (nextHit % 10))}${Math.floor(nextHit / 10) + 1}`
    await actAndRead(page, scenario, () =>
      page.getByRole('button', { name: `${cell}: unknown`, exact: true }).click(),
    )
  }
}

export async function verifyGame(page, scenario) {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const game = await api(route(scenario, fixture))
  await expect(page.getByRole('heading', { name: titles[scenario], exact: true })).toBeAttached()
  if (scenario === 'game-2048') {
    expect(game.mode).toBe('user')
    expect(game.moves).toBeGreaterThanOrEqual(16)
    expect(game.score).toBeGreaterThan(0)
    expect(Math.max(...game.board)).toBeGreaterThanOrEqual(8)
    const expected = game.board.flatMap((value, cell) => (value ? [{ cell, value }] : []))
    await expect
      .poll(async () =>
        page
          .locator('.game-2048-tile:not([data-leaving])')
          .evaluateAll((tiles) =>
            tiles
              .map((tile) => ({ cell: Number(tile.dataset.cell), value: Number(tile.textContent) }))
              .sort((a, b) => a.cell - b.cell),
          ),
      )
      .toEqual(expected)
    await expect(page.getByRole('radio', { name: 'I play', exact: true })).toBeChecked()
  } else if (scenario === 'chess') {
    expect(game.moves).toHaveLength(4)
    expect(game.you).toBe('white')
    await expect(page.getByRole('button', { name: 'e4: white pawn', exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'f1: white bishop', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.chess-target')).not.toHaveCount(0)
  } else if (scenario === 'checkers') {
    expect(game.moves).toHaveLength(4)
    expect(game.turn).toBe('white')
    await expect(page.locator('.checkers-square[aria-pressed="true"]')).toHaveCount(1)
    await expect(page.locator('.checkers-target')).not.toHaveCount(0)
  } else if (scenario === 'tic-tac-toe') {
    expect(game.status).toBe('won')
    expect(game.line).toEqual([0, 1, 2])
    expect(game.moves).toHaveLength(5)
    await expect(
      page.getByRole('button', { name: 'Cell 3, top right: X', exact: true }),
    ).toBeVisible()
  } else if (scenario === 'rock-paper-scissors') {
    expect(game.round.number).toBe(2)
    expect(game.round.outcome).toBe('won')
    expect(game.round.mine).toBe('scissors')
    expect(game.round.theirs).toMatchObject({ revealed: true, value: 'paper' })
    expect(game.record).toEqual({ won: 2, lost: 0, draw: 0 })
    await expect(page.getByRole('figure', { name: 'Agent: Paper', exact: true })).toBeVisible()
    await expect(page.getByRole('figure', { name: 'You: Scissors', exact: true })).toBeVisible()
    await expect(page.getByText('Scissors cut paper.', { exact: true })).toBeVisible()
    await expect(page.getByText('Digest checked', { exact: false })).toBeVisible()
  } else if (scenario === 'battleship') {
    expect(game.turn).toBe('you')
    expect(game.shots).toHaveLength(13)
    expect(game.shots.at(-1).result).toBe('sunk')
    expect(game.enemySeen).toHaveLength(1)
    await expect(page.getByRole('group', { name: 'The agent’s waters', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Your fleet', exact: true })).toBeVisible()
    await expect(page.locator('.bs-tile[data-state="sunk"]')).toHaveCount(4)
    await expect(page.locator('.bs-tile[data-state="hit"]')).toHaveCount(3)
  } else throw new Error(`Unknown game scenario: ${scenario}`)
  expect(game.waiting).toBeNull()
}
