import { expect, test } from 'bun:test'
import { commandWindow } from './commandWindow'

test('a command answers within ten seconds, plus the time its wait steps may take', () => {
  expect(commandWindow({ action: 'click' }).ms).toBe(10_000)
  expect(commandWindow({ action: 'steps', steps: [{ action: 'click', ref: 'e1' }] }).ms).toBe(
    10_000,
  )
  expect(
    commandWindow({
      action: 'steps',
      steps: [{ action: 'wait', text: 'Saved', timeoutMs: 12_000 }],
    }).ms,
  ).toBe(22_000)
  expect(commandWindow({ action: 'steps', steps: [{ action: 'wait', text: 'x' }] }).ms).toBe(20_000)
})

test('the native poll keeps asking for as many 25 ms turns as the window holds', () => {
  expect(commandWindow({ action: 'click' }).attempts).toBe(400)
  expect(commandWindow({ action: 'steps', steps: [{ action: 'wait', text: 'x' }] }).attempts).toBe(
    800,
  )
})
