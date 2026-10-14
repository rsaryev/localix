import { describe, expect, test } from 'bun:test'

import { isApiError } from '../../../lib/errors'
import { createSession, type SessionLifecycleCtx } from './session-lifecycle'

/**
 * A connection id that resolves to nothing is a REQUEST error, not a server fault.
 *
 * It used to reach the insert and fail the `provider_connections` foreign key, which the root
 * handler can only answer `500 Unexpected server error` — the shape every client got after the
 * database was recreated while it still named a connection from the old one.
 */
function ctx(overrides: Partial<SessionLifecycleCtx> = {}): SessionLifecycleCtx {
  const inserted: unknown[] = []
  return {
    repo: {
      allocateSessionRef: async () => ({ seq: 1, id: 'LOCALIX-1' }),
      insertSession: async (session: unknown) => void inserted.push(session),
      listSessionAncestry: async () => [],
      insertMessage: async () => {},
    },
    streamRegistry: { publish: () => {} },
    now: () => '2026-01-01T00:00:00.000Z',
    resolveDefaultProjectId: async () => 'PRJ-1',
    requireSession: async () => {
      throw new Error('no parent in these cases')
    },
    getSessionDetail: async () => ({ id: 'LOCALIX-1' }) as never,
    publishSession: () => {},
    ...overrides,
  } as unknown as SessionLifecycleCtx
}

describe('createSession — a stated provider connection must exist', () => {
  test('an unknown id is refused as a request error, before anything is allocated', async () => {
    let allocated = false
    const deps = ctx({
      connectionExists: async () => false,
      repo: {
        allocateSessionRef: async () => {
          allocated = true
          return { seq: 1, id: 'LOCALIX-1' }
        },
        insertSession: async () => {},
        listSessionAncestry: async () => [],
        insertMessage: async () => {},
      } as never,
    })

    const failure = await createSession(deps, 'u', {
      providerConnectionId: 'connection-that-is-gone',
    }).catch((error: unknown) => error)

    expect(isApiError(failure)).toBe(true)
    expect((failure as { status: number }).status).toBe(404)
    expect((failure as { code: string }).code).toBe('provider_connection_not_found')
    // Refused before the session ref is spent, so a retry does not leave a gap in the sequence.
    expect(allocated).toBe(false)
  })

  test('a connection the user holds is not refused', async () => {
    // The positive control: a guard that refused everything would also pass the test above.
    const asked: string[] = []
    const deps = ctx({
      connectionExists: async (_userId, connectionId) => {
        asked.push(connectionId)
        return true
      },
    })
    await createSession(deps, 'u', { providerConnectionId: 'connection-live' })
    expect(asked).toEqual(['connection-live'])
  })

  test('a session that states no connection is never asked about one', async () => {
    let asked = 0
    const deps = ctx({
      connectionExists: async () => {
        asked += 1
        return false
      },
    })
    await createSession(deps, 'u', {})
    expect(asked).toBe(0)
  })

  test('a host that wires no connections port still creates sessions', async () => {
    // A narrow host cannot check an id it has no way to look up, and failing the conversation
    // for that would be refusing the caller for the host's gap.
    await createSession(ctx(), 'u', { providerConnectionId: 'whatever' })
  })
})
