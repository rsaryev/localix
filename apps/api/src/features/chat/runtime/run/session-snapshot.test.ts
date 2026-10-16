import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRunSessionSnapshot, type RunSessionSnapshotRow } from './session-snapshot'

describe('per-run session snapshot', () => {
  test('loads the run projection instead of the wide UI roster', () => {
    const source = readFileSync(join(import.meta.dir, 'session-snapshot.ts'), 'utf8')
    expect(source).toContain('repo.listRunSessionSnapshotRows(userId)')
    expect(source).not.toContain('repo.listSessions(userId)')
  })

  test('shares one narrow roster query between ancestry and prompt consumers', async () => {
    let calls = 0
    const sessions: RunSessionSnapshotRow[] = [
      {
        id: 'root',
        userId: 'user-a',
        parentSessionId: null,
        sessionKind: 'chat',
        runtimeStatus: 'idle',
        title: 'Root',
        // Descendant rosters read `provenance` off this same row, so the projection carries it
        // and a fixture without it would type-check nothing the consumer actually reads.
        provenance: { kind: 'root' },
      },
    ]
    const load = createRunSessionSnapshot(
      {
        listRunSessionSnapshotRows: async (userId) => {
          calls += 1
          expect(userId).toBe('user-a')
          return sessions
        },
      },
      'user-a',
    )

    const ancestry = load()
    const descendants = load()

    expect(calls).toBe(1)
    expect(ancestry).toBe(descendants)
    expect(await ancestry).toBe(sessions)
    expect(await descendants).toBe(sessions)
  })
})
