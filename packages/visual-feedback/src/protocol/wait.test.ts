import { expect, test } from 'bun:test'
import { commandWaitMs, waitLimitMs } from './wait'

test('a wait defaults to 10 s, honours a shorter limit and never exceeds 15 s', () => {
  expect(waitLimitMs(undefined)).toBe(10_000)
  expect(waitLimitMs(2_500)).toBe(2_500)
  expect(waitLimitMs(120_000)).toBe(15_000)
  expect(waitLimitMs(-5)).toBe(0)
  expect(waitLimitMs(Number.NaN)).toBe(10_000)
})

test('a command may spend, waiting in the page, the sum of its wait steps', () => {
  expect(commandWaitMs({ steps: [{ action: 'click', ref: 'e1' }] })).toBe(0)
  expect(
    commandWaitMs({
      steps: [
        { action: 'wait', text: 'a', timeoutMs: 3_000 },
        { action: 'click', ref: 'e1' },
        { action: 'wait', selector: '.b' },
      ],
    }),
  ).toBe(13_000)
  expect(commandWaitMs({})).toBe(0)
})
