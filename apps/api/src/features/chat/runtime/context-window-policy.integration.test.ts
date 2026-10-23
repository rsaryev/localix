// The emulated session is deterministic and its window policy ordered (see the harness).
import { describe, expect, test } from 'bun:test'

import {
  runSession,
  sessionDatabasePerFile,
  type TurnLog,
} from './testing/context-window-session.test-harness'

sessionDatabasePerFile()

describe('the emulation is deterministic and the policy is ordered', () => {
  test('two replays of the same session produce the same log', async () => {
    const first = await runSession({ window: 272_000 })
    const second = await runSession({ window: 272_000 })
    expect(second).toEqual(first)
  }, 120_000)

  test('a 1M model on Auto lives in the same budget as a 400k one', async () => {
    const [large, mid] = [
      await runSession({ window: 1_000_000 }),
      await runSession({ window: 400_000 }),
    ]
    const turns = (logs: TurnLog[]) => logs.filter((l) => l.checkpoint).map((l) => l.turn)
    // 300k vs 299.2k policy windows: the same marks within a turn, never a 700k free-for-all.
    expect(turns(large).length).toBe(turns(mid).length)
    expect(Math.max(...large.map((l) => l.measured))).toBeLessThan(300_000)
  }, 120_000)
})
