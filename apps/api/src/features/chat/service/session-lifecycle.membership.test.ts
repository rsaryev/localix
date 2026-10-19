import { describe, expect, it } from 'bun:test'

import { updateSession, type SessionLifecycleCtx } from './session-lifecycle'
import type { SessionRecord } from '../repository'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'

/** A record and a context whose writes would succeed, so only the membership rule can refuse. */
function harness(over: Partial<SessionRecord>) {
  const record = sessionFixture({ id: 's1', userId: 'u1', agents: routedParticipants(), ...over })
  const ctx = {
    now: () => '2026-01-02 00:00:00',
    requireSession: async () => record,
    getSessionDetail: async () => ({}) as never,
    publishSession: () => {},
    streamRegistry: { publish: () => {} },
    repo: { updateSession: async () => {}, insertMessage: async () => {} },
  } as unknown as SessionLifecycleCtx
  return { ctx }
}

describe('who may change a conversation’s membership', () => {
  it.each(['subagent', 'job'] as const)('a %s session is its one agent’s task', async (kind) => {
    const { ctx } = harness({ sessionKind: kind, parentSessionId: 'root', rootSessionId: 'root' })
    await expect(
      updateSession(ctx, 'u1', 's1', { agents: [{ handle: 'qa' }] }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'membership_fixed',
    })
  })
})
