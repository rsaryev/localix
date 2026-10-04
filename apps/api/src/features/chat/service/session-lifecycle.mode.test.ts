import { describe, expect, it } from 'bun:test'

import type { PermissionMode } from '../../capabilities/permission-modes'
import { permissionModeChangeNotice } from '../runtime/session-notice'
import { updateSession, type SessionLifecycleCtx } from './session-lifecycle'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'

/**
 * A mode change is ONE line in the conversation — what the agent reads to learn its writes are
 * (or are no longer) refused — and one call of the mode hook the plans feature hangs its
 * "left plan mode" rule on. A patch that re-sends the current mode says nothing and calls nothing.
 */
function harness(mode: PermissionMode) {
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
    permissionMode: mode,
  })
  const lines: string[] = []
  const hooks: string[] = []
  const ctx = {
    now: () => '2026-01-02 00:00:00',
    requireSession: async () => record,
    getSessionDetail: async () => ({}) as never,
    publishSession: () => {},
    streamRegistry: { publish: () => {} },
    repo: {
      updateSession: async (_u: string, _id: string, patch: Partial<SessionRecord>) => {
        record = { ...record, ...patch }
      },
      insertMessage: async (message: PersistedMessage) => {
        lines.push(String(message.payload.content))
      },
    },
    onPermissionModeChanged: async (
      _u: string,
      _id: string,
      before: PermissionMode | undefined,
      after: PermissionMode,
    ) => {
      hooks.push(`${before}->${after}`)
    },
  } as unknown as SessionLifecycleCtx
  return { ctx, lines, hooks }
}

describe('a permission mode change, said in the conversation', () => {
  it('writes one line naming the mode and calls the mode hook once', async () => {
    const { ctx, lines, hooks } = harness('plan')
    await updateSession(ctx, 'u1', 'root', { permissionMode: 'default' })
    expect(lines).toEqual([
      "Permission mode: Default — the agent's own rules decide, and anything they ask about waits for the user.",
    ])
    expect(hooks).toEqual(['plan->default'])
  })

  it('says nothing and calls nothing when the mode did not move', async () => {
    const { ctx, lines, hooks } = harness('bypass')
    await updateSession(ctx, 'u1', 'root', { permissionMode: 'bypass' })
    expect(lines).toEqual([])
    expect(hooks).toEqual([])
  })

  it('each mode has its sentence; plan names what lifts it', () => {
    expect(permissionModeChangeNotice('default', 'plan')).toEqual({
      kind: 'permission_mode_change',
      tone: 'info',
      text: 'Permission mode: Plan — read-only until a plan is approved.',
      // The mode itself travels with the line, so the transcript draws its own icon and tone.
      mode: 'plan',
    })
    expect(permissionModeChangeNotice('plan', 'autonomous')?.text).toContain('Autonomous')
    expect(permissionModeChangeNotice('plan', 'plan')).toBeNull()
  })
})
