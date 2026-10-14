import { describe, expect, test } from 'bun:test'

import { armShutdownDeadline } from './shutdown-deadline'

describe('shutdown deadline', () => {
  test('a teardown that never settles still leaves', async () => {
    const exits: number[] = []
    // The shape of the real failure: one cleanup step whose promise never resolves.
    const wedged = new Promise<void>(() => {})
    armShutdownDeadline({ ms: 20, exit: (code) => exits.push(code) })
    await Promise.race([wedged, Bun.sleep(120)])
    expect(exits).toEqual([0])
  })

  test('a teardown that finishes in time is never cut short', async () => {
    const exits: number[] = []
    const deadline = armShutdownDeadline({ ms: 50, exit: (code) => exits.push(code) })
    await Bun.sleep(5)
    deadline.disarm()
    await Bun.sleep(120)
    expect(exits).toEqual([])
  })

  test('best-effort cleanup runs before leaving, and a throwing one does not prevent it', async () => {
    const order: string[] = []
    armShutdownDeadline({
      ms: 20,
      onExpire: () => {
        order.push('cleanup')
        throw new Error('unlink failed')
      },
      exit: () => order.push('exit'),
    })
    await Bun.sleep(120)
    // Leaving is the point; the cleanup is only an optimization for the next start.
    expect(order).toEqual(['cleanup', 'exit'])
  })
})
