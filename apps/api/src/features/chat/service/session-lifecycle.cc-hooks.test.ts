/**
 * A session edit is where Claude Code's between-turn events fire: the picker's model switch
 * (PreModelSwitch before the write, PostModelSwitch after) and a project move (CwdChanged).
 */
import { describe, expect, it } from 'bun:test'

import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../cc-hooks'
import { createCcHookSessions } from '../runtime/cc-hook-sessions'
import { updateSession, type SessionLifecycleCtx } from './session-lifecycle'
import type { SessionRecord } from '../repository'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'

function harness(hooks: Partial<CcHooksRuntime>) {
  let record: SessionRecord = sessionFixture({
    id: 'root',
    userId: 'u1',
    seq: 1,
    title: 'Chat',
    agents: routedParticipants({ modelId: 'claude-sonnet-5' }),
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    lastMessageAt: '2026-01-01 00:00:00',
    rootSessionId: 'root',
    projectId: 'p1',
  })
  const routesWritten: unknown[] = []
  const ccHookSessions = createCcHookSessions()
  const runtime: CcHooksRuntime = {
    ...INERT_CC_HOOKS,
    active: true,
    hasHooks: () => true,
    ...hooks,
  }
  ccHookSessions.runtimeFor = () => runtime
  const ctx = {
    now: () => '2026-01-02 00:00:00',
    requireSession: async () => record,
    getSessionDetail: async () => ({}) as never,
    publishSession: () => {},
    projectExists: async () => true,
    streamRegistry: { publish: () => {} },
    ccHookSessions,
    resolveSessionWorkingDir: async (_u: string, s: SessionRecord) => `/work/${s.projectId}`,
    repo: {
      updateSession: async (_u: string, _id: string, patch: Partial<SessionRecord>) => {
        record = { ...record, ...patch }
      },
      updateSessionAgentRoutes: async (_u: string, _id: string, routes: unknown[]) => {
        routesWritten.push(...routes)
      },
      insertMessage: async () => {},
    },
  } as unknown as SessionLifecycleCtx
  return { ctx, routesWritten, ccHookSessions }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('Claude Code hooks on a session edit', () => {
  it('a PreModelSwitch deny keeps the model: nothing is written', async () => {
    const { ctx, routesWritten } = harness({
      runPreModelSwitch: async () => ({ decision: 'deny', reason: 'not this model' }),
    })
    await expect(
      updateSession(ctx, 'u1', 'root', { route: { modelId: 'claude-opus-4-6' } }),
    ).rejects.toThrow('not this model')
    expect(routesWritten).toEqual([])
  })

  it('an allowed switch is written, then PostModelSwitch leaves context for the next turn', async () => {
    const seen: string[] = []
    const { ctx, routesWritten, ccHookSessions } = harness({
      runPreModelSwitch: async (change) => {
        seen.push(`pre ${change.fromModel}->${change.toModel} (${change.source})`)
        return { decision: 'proceed' }
      },
      runPostModelSwitch: async (change) => ({ additionalContext: `on ${change.toModel}` }),
    })
    await updateSession(ctx, 'u1', 'root', { route: { modelId: 'claude-opus-5' } })
    await settle()
    expect(seen).toEqual(['pre claude-sonnet-5->claude-opus-5 (picker)'])
    expect(routesWritten).toHaveLength(1)
    expect(ccHookSessions.takeContext('root')).toBe('on claude-opus-5')
  })

  it('a move to another project fires CwdChanged with both directories', async () => {
    const moves: string[] = []
    const { ctx } = harness({
      runCwdChanged: async (from, to) => {
        moves.push(`${from} -> ${to}`)
        return {}
      },
    })
    await updateSession(ctx, 'u1', 'root', { projectId: 'p2' })
    await settle()
    expect(moves).toEqual(['/work/p1 -> /work/p2'])
  })
})
