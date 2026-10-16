import { describe, expect, test } from 'bun:test'
import { makeManualTransaction } from './manual-transaction'

function session(options: { commitFails?: boolean; rollbackFails?: boolean } = {}) {
  const calls: string[] = []
  return {
    calls,
    tx: makeManualTransaction({
      query: async () => ({ columns: [], rows: [], durationMs: 0 }),
      commit: async () => {
        calls.push('commit')
        if (options.commitFails) throw new Error('serialization failure')
      },
      rollback: async () => {
        calls.push('rollback')
        if (options.rollbackFails) throw new Error('connection lost')
      },
      release: () => calls.push('release'),
    }),
  }
}

describe('makeManualTransaction', () => {
  test('commit is idempotent and releases once', async () => {
    const { tx, calls } = session()
    await tx.commit()
    await tx.commit()
    await tx.rollback()
    expect(calls).toEqual(['commit', 'release'])
  })

  test('a failed commit rolls back, releases, and still reports the failure', async () => {
    const { tx, calls } = session({ commitFails: true, rollbackFails: true })
    await expect(tx.commit()).rejects.toThrow('serialization failure')
    expect(calls).toEqual(['commit', 'rollback', 'release'])
  })

  test('rollback never throws and releases once', async () => {
    const { tx, calls } = session({ rollbackFails: true })
    await tx.rollback()
    await tx.rollback()
    expect(calls).toEqual(['rollback', 'release'])
  })
})
