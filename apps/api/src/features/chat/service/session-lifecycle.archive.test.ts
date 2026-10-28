import { describe, expect, it } from 'bun:test'

import { updateSession, type SessionLifecycleCtx } from './session-lifecycle'
import type { SessionRecord } from '../repository'
import { SESSION_TITLE_MAX_CHARS } from '../session-limits'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'

/**
 * updateSession maps the wire flag `isArchived` onto the durable `archived_at`
 * timestamp: archiving stamps a time, unarchiving clears it to null, and
 * re-archiving an already-archived session keeps the ORIGINAL stamp (so the
 * archive time isn't reset by an unrelated update).
 */
function baseSession(over: Partial<SessionRecord> = {}): SessionRecord {
  return sessionFixture({
    id: 's1',
    userId: 'u1',
    seq: 1,
    title: 'Chat',
    agent: routedAgent({ modelId: 'm', reasoningEffort: 'low' }),
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    lastMessageAt: '2026-01-01 00:00:00',
    rootSessionId: 's1',
    ...over,
  })
}

function makeCtx(session: SessionRecord) {
  let saved: Partial<SessionRecord> | null = null
  const routeWrites: Record<string, unknown>[] = []
  const ctx: SessionLifecycleCtx = {
    // A session always belongs to a project; this fixture never creates one, but the port is
    // required so a host cannot forget it.
    resolveDefaultProjectId: async () => 'PRJ-test',
    repo: {
      listSessions: async () => [],
      listSessionAncestry: async () => [],
      lastMessagesByUser: async () => new Map(),
      allocateSessionRef: async () => ({ seq: 1, id: 'x' }),
      insertSession: async () => {},
      getSession: async () => session,
      updateSession: async (_u, _id, next) => {
        saved = next
      },
      updateSessionAgentRoute: async (_u, _id, route) => {
        routeWrites.push(route as Record<string, unknown>)
      },
      deleteSession: async () => {},
      listChildSessionIds: async () => [],
      // A model change writes a line into the conversation. Archiving writes none, so this stub
      // records nothing — it is here because the port is required.
      insertMessage: async () => {},
    },
    streamRegistry: { publish: () => {} },
    runner: {
      withSessionsQuiesced: async <T>(_ids: readonly string[], operation: () => Promise<T>) =>
        operation(),
      stop: async () => true,
      forgetSession: async () => {},
    },
    now: () => '2026-02-02 12:00:00',
    requireSession: async () => session,
    getSessionDetail: async () => ({}) as never,
    publishSession: () => {},
  }
  return { ctx, getSaved: () => saved, getRouteWrites: () => routeWrites }
}

describe('updateSession — archive', () => {
  it('stamps archived_at when isArchived becomes true', async () => {
    const { ctx, getSaved } = makeCtx(baseSession())
    await updateSession(ctx, 'u1', 's1', { isArchived: true })
    expect(getSaved()?.archivedAt).toBe('2026-02-02 12:00:00')
  })

  it('clears archived_at when isArchived becomes false', async () => {
    const { ctx, getSaved } = makeCtx(baseSession({ archivedAt: '2026-01-05 09:00:00' }))
    await updateSession(ctx, 'u1', 's1', { isArchived: false })
    expect(getSaved()?.archivedAt).toBeNull()
  })

  it('keeps the original archive time when re-archiving', async () => {
    const { ctx, getSaved } = makeCtx(baseSession({ archivedAt: '2026-01-05 09:00:00' }))
    await updateSession(ctx, 'u1', 's1', { isArchived: true })
    expect(getSaved()?.archivedAt).toBe('2026-01-05 09:00:00')
  })

  it('writes only what the patch names — a rename cannot overwrite a newer runtime status', async () => {
    // The patch used to be the whole record read at the start of the request, and the repository
    // writes every field it is handed: a rename then wrote its stale `runtimeStatus` (and every
    // other field) back over a run that had started in between.
    const { ctx, getSaved } = makeCtx(
      baseSession({ archivedAt: '2026-01-05 09:00:00', runtimeStatus: 'idle' }),
    )
    await updateSession(ctx, 'u1', 's1', { title: 'Renamed' })
    expect(getSaved()).toEqual({ title: 'Renamed', updatedAt: '2026-02-02 12:00:00' })
  })

  it('normalizes and caps titles from trusted internal callers too', async () => {
    const { ctx, getSaved } = makeCtx(baseSession())
    await updateSession(ctx, 'u1', 's1', {
      title: `  ${'x'.repeat(SESSION_TITLE_MAX_CHARS + 20)}\nignored  `,
    })
    expect(getSaved()?.title).toBe('x'.repeat(SESSION_TITLE_MAX_CHARS))
  })
})

describe('updateSession — permission mode', () => {
  it('writes the mode a root conversation is set to', async () => {
    const { ctx, getSaved } = makeCtx(baseSession())
    await updateSession(ctx, 'u1', 's1', { permissionMode: 'plan' })
    expect(getSaved()).toEqual({ permissionMode: 'plan', updatedAt: '2026-02-02 12:00:00' })
  })

  it('refuses a mode on a delegated child before writing anything', async () => {
    // A child runs under its root's mode; a mode set on it alone would make one worker in a
    // plan conversation able to write until the root's next change overwrote it.
    const { ctx, getSaved } = makeCtx(
      baseSession({ parentSessionId: 'root', rootSessionId: 'root' }),
    )
    await expect(
      updateSession(ctx, 'u1', 's1', { permissionMode: 'bypass', title: 'x' }),
    ).rejects.toMatchObject({ status: 409, code: 'permission_mode_owned_by_root' })
    expect(getSaved()).toBeNull()
  })
})

describe('updateSession — model selection', () => {
  it('writes the chosen route as a point update', async () => {
    const { ctx, getRouteWrites, getSaved } = makeCtx(
      baseSession({
        agent: routedAgent({
          providerConnectionId: 'connection-old',
          modelId: 'old/model',
        }),
      }),
    )

    await updateSession(ctx, 'u1', 's1', {
      route: { providerConnectionId: 'connection-new', modelId: 'openai/gpt-5.4' },
    })

    // Only what the picker named is written: the record it holds carries routes the chain
    // RESOLVED, and writing those back would freeze an inheritance into a choice.
    expect(getRouteWrites()).toEqual([
      { providerConnectionId: 'connection-new', modelId: 'openai/gpt-5.4' },
    ])
    // A route change names no session field, so the session row is not written at all.
    expect(getSaved()).toBeNull()
  })
})
