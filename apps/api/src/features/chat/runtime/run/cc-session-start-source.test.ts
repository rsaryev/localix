/**
 * hooks.md, SessionStart `source`: `startup` for a new session, `resume` for one taken up again
 * (here, an existing session's first run after the API restarted), `fork` for a forked session's
 * first run, and `clear` / `compact` when the view was reset or rewritten.
 */
import { describe, expect, test } from 'bun:test'
import { tempDirPerTest } from '@localixai/testing'

import { sessionStartSource } from './cc-session-start-source'

const root = tempDirPerTest('cc-start-source-')

describe('SessionStart source', () => {
  test('startup the first time, resume when the session ran before this process', async () => {
    const session = { id: 's1', provenance: { kind: 'root' as const } }
    expect(await sessionStartSource(session, root())).toBe('startup')
    // The API restarted: the in-memory "started" set is empty, the session is not new.
    expect(await sessionStartSource(session, root())).toBe('resume')
  })

  test('fork for a forked session’s first run', async () => {
    const forked = { id: 's2', provenance: { kind: 'fork' as const, parentSessionId: 's1' } }
    expect(await sessionStartSource(forked, root())).toBe('fork')
    expect(await sessionStartSource(forked, root())).toBe('resume')
  })

  test('a pending clear or compact wins', async () => {
    expect(
      await sessionStartSource(
        { id: 's3', provenance: { kind: 'root' as const } },
        root(),
        'clear',
      ),
    ).toBe('clear')
  })
})
