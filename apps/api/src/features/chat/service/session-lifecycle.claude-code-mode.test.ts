import { describe, expect, it } from 'bun:test'

import type { PermissionMode } from '../../../contracts/permission-modes'
import { birthRoute } from '../agent-route-resolution'
import type { SessionRecord } from '../repository'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { createSession, updateSession, type SessionLifecycleCtx } from './session-lifecycle'

/**
 * Claude Code's `permissions.defaultMode` is the mode a new conversation starts in, and
 * `permissions.disableBypassPermissionsMode: "disable"` keeps a conversation out of the modes that
 * stop asking (permissions.md, "Permission modes"), read for the conversation's folder.
 */
function harness(
  modes: { defaultMode?: PermissionMode; bypassDisabled: boolean },
  parentMode: PermissionMode = 'default',
) {
  let record: SessionRecord = sessionFixture({
    id: 'root',
    userId: 'u1',
    seq: 1,
    title: 'Chat',
    agents: routedParticipants({ modelId: 'm' }),
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    lastMessageAt: '2026-01-01 00:00:00',
    rootSessionId: 'root',
    permissionMode: parentMode,
  })
  let inserted: SessionRecord | null = null
  const ctx = {
    now: () => '2026-01-02 00:00:00',
    resolveDefaultProjectId: async () => 'PRJ-default',
    resolveSessionAgent: async () => ({ id: 'builtin:localix', handle: 'localix' }),
    seatRoute: async (_u: string, _p: string | null, _a: string, given = {}) =>
      birthRoute({ ...given, agent: null }),
    requireSession: async () => record,
    getSessionDetail: async () => ({}) as never,
    publishSession: () => {},
    streamRegistry: { publish: () => {} },
    resolveSessionWorkingDir: async () => '/work/repo',
    claudeCodeModes: async (cwd: string) => {
      expect(cwd).toBe('/work/repo')
      return modes
    },
    repo: {
      listSessions: async () => [record],
      listSessionAncestry: async () => [record],
      allocateSessionRef: async () => ({ seq: 2, id: 'new' }),
      insertSession: async (session: SessionRecord) => {
        inserted = session
      },
      updateSession: async (_u: string, _id: string, patch: Partial<SessionRecord>) => {
        record = { ...record, ...patch }
      },
      insertMessage: async () => {},
    },
  } as unknown as SessionLifecycleCtx
  return { ctx, inserted: () => inserted, record: () => record }
}

describe("Claude Code's permission mode settings", () => {
  it('a new conversation starts in the mode defaultMode names', async () => {
    const { ctx, inserted } = harness({ defaultMode: 'plan', bypassDisabled: false })
    await createSession(ctx, 'u1', {})
    expect(inserted()?.permissionMode).toBe('plan')
  })

  it('a delegated child keeps its tree’s mode', async () => {
    const { ctx, inserted } = harness({ defaultMode: 'plan', bypassDisabled: false })
    await createSession(ctx, 'u1', { parentSessionId: 'root', sessionKind: 'job' })
    expect(inserted()?.permissionMode).toBe('default')
  })

  it('a fork runs under the mode of the conversation that made it, whatever the default is now', async () => {
    const { ctx, inserted } = harness({ defaultMode: 'bypass', bypassDisabled: false }, 'plan')
    await createSession(ctx, 'u1', {
      parentSessionId: 'root',
      sessionKind: 'subagent',
      sourceToolCallId: 'd1',
      provenance: {
        kind: 'task-delegation',
        parentSessionId: 'root',
        toolCallId: 'd1',
        fork: { baseMessageId: null, snapshotMessageId: 'copy' },
      },
    })
    expect(inserted()?.permissionMode).toBe('plan')
  })

  it('a disabled bypass is refused, and never the starting mode', async () => {
    const { ctx, inserted, record } = harness({ defaultMode: 'bypass', bypassDisabled: true })
    await createSession(ctx, 'u1', {})
    expect(inserted()?.permissionMode ?? 'default').toBe('default')
    for (const mode of ['bypass', 'autonomous'] as const)
      await expect(
        updateSession(ctx, 'u1', 'root', { permissionMode: mode }),
      ).rejects.toMatchObject({ code: 'bypass_disabled' })
    expect(record().permissionMode).toBe('default')
    await updateSession(ctx, 'u1', 'root', { permissionMode: 'plan' })
    expect(record().permissionMode).toBe('plan')
  })
})
