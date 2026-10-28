import { describe, expect, test } from 'bun:test'

import { isApiError } from '../../../lib/errors'
import { createSession, type SessionLifecycleCtx } from './session-lifecycle'

/**
 * A project id from a recreated database is a missing PROJECT, not an unavailable agent.
 *
 * The route resolver cannot find agents in a project that does not exist, so the New chat a
 * stale workspace window minted for it was refused as `agent_unavailable` — "Selected agent is
 * unavailable", about the wrong thing, and with nothing the client could recognize and drop.
 */
function ctx(overrides: Partial<SessionLifecycleCtx> = {}): SessionLifecycleCtx {
  return {
    repo: {
      allocateSessionRef: async () => ({ seq: 1, id: 'LOCALIX-1' }),
      insertSession: async () => {},
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

describe('createSession — a stated project must exist', () => {
  test('an unknown project is refused as project_not_found before choosing anyone', async () => {
    let created = 0
    const deps = ctx({
      projectExists: async (_userId, projectId) => projectId === 'PRJ-1',
      resolveSessionAgent: async () => {
        created += 1
        return null
      },
    })
    const failure = await createSession(deps, 'u', { projectId: 'PRJ-11' }).catch(
      (error: unknown) => error,
    )
    expect(isApiError(failure)).toBe(true)
    expect((failure as { status: number }).status).toBe(404)
    expect((failure as { code: string }).code).toBe('project_not_found')
    expect(created).toBe(0)
  })

  test('a project the user holds is not refused', async () => {
    const asked: string[] = []
    const deps = ctx({
      projectExists: async (_userId, projectId) => {
        asked.push(projectId)
        return true
      },
    })
    await createSession(deps, 'u', { projectId: 'PRJ-1' })
    expect(asked).toEqual(['PRJ-1'])
  })

  test('the default project is never re-checked', async () => {
    let asked = 0
    const deps = ctx({
      projectExists: async () => {
        asked += 1
        return false
      },
    })
    await createSession(deps, 'u', {})
    expect(asked).toBe(0)
  })
})
