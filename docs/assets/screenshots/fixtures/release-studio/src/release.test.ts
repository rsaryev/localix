import { expect, test } from 'bun:test'
import { isReady, release } from './release'

test('a release waits for every check', () => {
  expect(isReady(release)).toBe(false)
})

test('a checked release is ready', () => {
  expect(
    isReady({ ...release, checks: release.checks.map((check) => ({ ...check, done: true })) }),
  ).toBe(true)
})
