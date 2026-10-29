import { describe, expect, test } from 'bun:test'

import { untilAppleAnswers } from './apple-retry.mjs'

const runner = (codes: number[]) => {
  const calls: string[][] = []
  const run = async (command: string[]) => {
    calls.push(command)
    return codes.shift() ?? 0
  }
  return { run, calls }
}

describe('a notarization step that asks Apple', () => {
  // `stapler validate` exits 68 when CloudKit drops the connection; the ticket is there.
  test('is asked again when Apple drops the connection, and passes when it answers', async () => {
    const { run, calls } = runner([68, 68, 0])
    const waits: number[] = []
    const code = await untilAppleAnswers(run, ['xcrun', 'stapler', 'validate', 'a.dmg'], {
      wait: async (ms) => void waits.push(ms),
    })
    expect(code).toBe(0)
    expect(calls).toHaveLength(3)
    expect(waits).toEqual([30_000, 30_000])
  })

  test('fails with the last answer once the attempts run out', async () => {
    const { run, calls } = runner([68, 68, 68, 68, 68])
    const code = await untilAppleAnswers(run, ['xcrun', 'stapler', 'validate', 'a.dmg'], {
      wait: async () => {},
    })
    expect(code).toBe(68)
    expect(calls).toHaveLength(4)
  })
})
