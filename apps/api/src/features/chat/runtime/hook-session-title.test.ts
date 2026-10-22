import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../repository'
import type { RunnerDeps } from './agent-runner-types'
import { applyHookSessionTitle } from './hook-session-title'

/** A repo holding one session, and the events a client would have been sent. */
function fakeDeps() {
  const session = { id: 's1', title: 'New Chat' } as SessionRecord
  const events: { type: string }[] = []
  const deps = {
    repo: {
      updateSession: async (_userId: string, _id: string, patch: Partial<SessionRecord>) => {
        Object.assign(session, patch)
      },
      getSession: async () => session,
    },
    streamRegistry: {
      publish: (_u: string, _s: string, event: { type: string }) => events.push(event),
    },
  } as unknown as Pick<RunnerDeps, 'repo' | 'streamRegistry'>
  return { deps, session, events }
}

describe('a hook’s sessionTitle', () => {
  test('renames the session and tells open clients', async () => {
    const { deps, session, events } = fakeDeps()
    await applyHookSessionTitle(deps, 'u1', 's1', '  auth-refactor ')
    expect(session.title).toBe('auth-refactor')
    expect(events.map((event) => event.type)).toEqual(['session.updated'])
  })

  test('no title leaves the session alone', async () => {
    const { deps, session, events } = fakeDeps()
    await applyHookSessionTitle(deps, 'u1', 's1', undefined)
    await applyHookSessionTitle(deps, 'u1', 's1', '   ')
    expect(session.title).toBe('New Chat')
    expect(events).toEqual([])
  })
})
