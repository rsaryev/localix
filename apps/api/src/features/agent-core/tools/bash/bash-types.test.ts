import { expect, test } from 'bun:test'

import { prepareBashArguments } from './bash-types'

test('LOCALIX-170: a timeout written in milliseconds is read as seconds', () => {
  expect(prepareBashArguments({ command: 'bun install', timeout: 120000 })).toEqual({
    command: 'bun install',
    timeout: 120,
  })
})

test('seconds, and milliseconds with no whole-second reading under the cap, are untouched', () => {
  for (const timeout of [60, 600, 601, 1500, 900000]) {
    const raw = { command: 'x', timeout }
    expect(prepareBashArguments(raw)).toBe(raw)
  }
})

test("Claude Code's description label is dropped instead of failing the call", () => {
  expect(prepareBashArguments({ command: 'git status', description: 'Check status' })).toEqual({
    command: 'git status',
  })
})
