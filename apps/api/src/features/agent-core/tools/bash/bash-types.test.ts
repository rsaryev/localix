import { expect, test } from 'bun:test'

import { prepareBashArguments } from './bash-types'

test('LOCALIX-170: a timeout written in milliseconds is read as seconds', () => {
  expect(prepareBashArguments({ command: 'bun install', timeout: 120000 })).toEqual({
    command: 'bun install',
    timeout: 120,
  })
})

test('seconds, and a timeout past Claude Code’s 600000 ms cap, are untouched', () => {
  for (const timeout of [60, 600, 900000]) {
    const raw = { command: 'x', timeout }
    expect(prepareBashArguments(raw)).toBe(raw)
  }
})

test('a timeout above 600 is Claude Code’s milliseconds, rounded up to whole seconds', () => {
  expect(prepareBashArguments({ command: 'x', timeout: 1500 })).toEqual({
    command: 'x',
    timeout: 2,
  })
  expect(prepareBashArguments({ command: 'x', timeout: 600_000 })).toEqual({
    command: 'x',
    timeout: 600,
  })
  expect(prepareBashArguments({ command: 'x', timeout: 601 })).toEqual({ command: 'x', timeout: 1 })
})

test('run_in_background is background; two spellings that disagree are refused', () => {
  expect(prepareBashArguments({ command: 'x', run_in_background: true })).toEqual({
    command: 'x',
    background: true,
  })
  expect(
    prepareBashArguments({ command: 'x', run_in_background: false, background: false }),
  ).toEqual({ command: 'x', background: false })
  expect(() =>
    prepareBashArguments({ command: 'x', run_in_background: true, background: false }),
  ).toThrow(/run_in_background/)
})

test('a sandbox opt-out Claude Code accepts is dropped, never granted', () => {
  expect(prepareBashArguments({ command: 'x', dangerouslyDisableSandbox: true })).toEqual({
    command: 'x',
  })
})

test("Claude Code's description label is dropped instead of failing the call", () => {
  expect(prepareBashArguments({ command: 'git status', description: 'Check status' })).toEqual({
    command: 'git status',
  })
})
