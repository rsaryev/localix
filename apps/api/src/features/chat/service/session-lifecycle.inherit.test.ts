import { describe, expect, it } from 'bun:test'

import { DEFAULT_REASONING_EFFORT, type ReasoningEffort } from '@localixai/agent'
import { createSession, type SessionLifecycleCtx } from './session-lifecycle'
import type { SessionRecord } from '../repository'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { sessionRoute } from '../session-route'

/**
 * A child session is created fresh, not cloned from its parent, so every setting the
 * parent chose has to be threaded deliberately. `reasoningEffort` is one: a `delegate` child
 * of a `max`-effort run used to fall to the flat `"low"` default and hand back a weak
 * conclusion the parent then redid.
 */
function parentSession(over: Partial<SessionRecord> = {}): SessionRecord {
  return sessionFixture({
    id: 'parent',
    userId: 'u1',
    seq: 1,
    title: 'Chat',
    agents: routedParticipants({ modelId: 'm', reasoningEffort: 'max' }),
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    lastMessageAt: '2026-01-01 00:00:00',
    rootSessionId: 'parent',
    ...over,
  })
}

function makeCtx(
  parent: SessionRecord | null,
  sessions: SessionRecord[] = parent ? [parent] : [],
  /** What the model chain answers for a new seat's effort, if anything. */
  chainEffort: ReasoningEffort | null = null,
) {
  let inserted: SessionRecord | null = null
  let rosterReads = 0
  let ancestryReads = 0
  let effortLookups = 0
  const ctx: SessionLifecycleCtx = {
    resolveDefaultProjectId: async () => 'PRJ-default',
    repo: {
      listSessions: async () => {
        rosterReads += 1
        return sessions
      },
      listSessionAncestry: async () => {
        ancestryReads += 1
        return sessions
      },
      allocateSessionRef: async () => ({ seq: 2, id: 'child' }),
      insertSession: async (s: SessionRecord) => {
        inserted = s
      },
      updateSession: async () => {},
      deleteSession: async () => {},
      listChildSessionIds: async () => [],
    },
    streamRegistry: { publish: () => {} },
    runner: {
      withSessionsQuiesced: async <T>(_ids: readonly string[], operation: () => Promise<T>) =>
        operation(),
      stop: async () => true,
      forgetSession: () => {},
    },
    now: () => '2026-02-02 12:00:00',
    seatEffort: async () => {
      effortLookups += 1
      return chainEffort ?? DEFAULT_REASONING_EFFORT
    },
    requireSession: async () => {
      if (!parent) throw new Error('no parent')
      return parent
    },
    getSessionDetail: async () => ({}) as never,
    publishSession: () => {},
  } as unknown as SessionLifecycleCtx
  return {
    ctx,
    getInserted: () => inserted as SessionRecord,
    getAncestryReads: () => ({ rosterReads, ancestryReads }),
    getEffortLookups: () => effortLookups,
  }
}

describe('createSession — what a child inherits', () => {
  it("takes the parent's reasoning effort, not the flat default", async () => {
    const { ctx, getInserted } = makeCtx(parentSession())
    await createSession(ctx, 'u1', { parentSessionId: 'parent', sessionKind: 'job' })
    expect(sessionRoute(getInserted()).reasoningEffort).toBe('max')
  })

  it('an explicit effort still wins — a delegated role may pin its own', async () => {
    const { ctx, getInserted } = makeCtx(parentSession())
    await createSession(ctx, 'u1', {
      parentSessionId: 'parent',
      sessionKind: 'job',
      reasoningEffort: 'low',
    })
    expect(sessionRoute(getInserted()).reasoningEffort).toBe('low')
  })

  it('a top-level session with no parent takes the default level', async () => {
    const { ctx, getInserted } = makeCtx(null)
    await createSession(ctx, 'u1', {})
    expect(sessionRoute(getInserted()).reasoningEffort).toBe(DEFAULT_REASONING_EFFORT)
    expect(getInserted().provenance).toEqual({ kind: 'root' })
  })

  it("a root chat is born on the level the chain gives it — the agent's own, or its last", async () => {
    // The effort is the one field settled AT BIRTH (`agent-route-resolution.ts` says why): a
    // dial that moved under a running conversation whenever a level below it changed would be
    // a different promise than the one the user set.
    const { ctx, getInserted } = makeCtx(null, [], 'high')
    await createSession(ctx, 'u1', { projectId: 'PRJ-1' })
    expect(sessionRoute(getInserted()).reasoningEffort).toBe('high')
  })

  it('a child never asks the chain for a level — it takes its parent’s', async () => {
    const { ctx, getInserted, getEffortLookups } = makeCtx(
      parentSession({ projectId: 'PRJ-1' }),
      undefined,
      'low',
    )
    await createSession(ctx, 'u1', { parentSessionId: 'parent', sessionKind: 'job' })
    expect(sessionRoute(getInserted()).reasoningEffort).toBe('max')
    expect(getEffortLookups()).toBe(0)
  })

  it('stores no model when the caller chose none', async () => {
    // Creation records CHOICES only. The project, the agent's card and the last-used route are
    // applied when the session is read (`session-route-defaults.ts`), which is what lets a
    // participant keep following a level instead of being frozen to its value at birth.
    const { ctx, getInserted } = makeCtx(null)
    await createSession(ctx, 'u1', { projectId: 'PRJ-1' })
    expect(sessionRoute(getInserted()).modelId).toBe('')
    expect(sessionRoute(getInserted()).providerConnectionId).toBeNull()
  })

  it('preserves an explicitly chosen model', async () => {
    const { ctx, getInserted } = makeCtx(null)
    await createSession(ctx, 'u1', {
      projectId: 'PRJ-1',
      providerConnectionId: 'picked-connection',
      modelId: 'selected/model',
    })
    expect(sessionRoute(getInserted()).providerConnectionId).toBe('picked-connection')
    expect(sessionRoute(getInserted()).modelId).toBe('selected/model')
  })

  it("uses the parent's effective model as a child's final fallback", async () => {
    // A child must always be executable when its parent is. Agent-specific choices have already
    // been resolved on the parent; an otherwise unconfigured child uses the room's main model.
    const { ctx, getInserted } = makeCtx(parentSession({ projectId: 'PRJ-1' }))
    await createSession(ctx, 'u1', {
      parentSessionId: 'parent',
      projectId: 'PRJ-1',
      sessionKind: 'job',
    })
    expect(sessionRoute(getInserted()).modelId).toBe('m')
    expect(sessionRoute(getInserted()).modelOrigin).toBe('primary')
  })

  it("inherits the assigned participant's resolved route before the room's main route", async () => {
    const parent = parentSession({
      projectId: 'PRJ-1',
      agents: [
        ...routedParticipants({ modelId: 'main/model' }),
        ...routedParticipants({
          agentId: 'builtin:architect',
          handle: 'architect',
          modelId: 'architect/model',
          providerConnectionId: 'architect-connection',
        }),
      ],
    })
    const { ctx, getInserted } = makeCtx(parent)
    await createSession(ctx, 'u1', {
      agents: [{ agentId: 'builtin:architect' }],
      parentSessionId: 'parent',
      projectId: 'PRJ-1',
      sessionKind: 'job',
    })
    expect(sessionRoute(getInserted())).toMatchObject({
      agentId: 'builtin:architect',
      providerConnectionId: 'architect-connection',
      modelId: 'architect/model',
      modelOrigin: 'primary',
    })
  })

  it('defaults missing child provenance to unknown-origin and rejects root widening', async () => {
    const { ctx, getInserted } = makeCtx(parentSession())
    await createSession(ctx, 'u1', {
      parentSessionId: 'parent',
      sessionKind: 'job',
      provenance: { kind: 'root' },
    })
    expect(getInserted().provenance).toEqual({ kind: 'unknown-origin' })
  })

  it('derives a grandchild root by walking parents and ignores a conflicting root hint', async () => {
    const root = parentSession({ id: 'root', rootSessionId: 'root' })
    const parent = parentSession({
      id: 'parent',
      parentSessionId: 'root',
      rootSessionId: 'stale-or-forged',
      sessionKind: 'job',
      provenance: { kind: 'loop', parentSessionId: 'root', loopId: 'loop-1' },
    })
    const { ctx, getInserted, getAncestryReads } = makeCtx(parent, [root, parent])
    await createSession(ctx, 'u1', {
      parentSessionId: 'parent',
      rootSessionId: 'foreign-root',
      sessionKind: 'job',
    })
    expect(getInserted().rootSessionId).toBe('root')
    expect(getAncestryReads()).toEqual({ rosterReads: 0, ancestryReads: 1 })
  })

  it('refuses to create below a missing ancestor', async () => {
    const parent = parentSession({ parentSessionId: 'gone', sessionKind: 'job' })
    const { ctx } = makeCtx(parent, [parent])
    await Promise.resolve(
      expect(
        createSession(ctx, 'u1', { parentSessionId: 'parent', sessionKind: 'job' }),
      ).rejects.toThrow('missing-ancestor at gone'),
    )
  })

  // A subagent nobody can trace to the call that asked for it has no report address and no
  // parent to charge: birth refuses it rather than create an orphan the budget cannot see.
  it('requires every subagent to originate from its parent’s delegating tool call', async () => {
    const { ctx } = makeCtx(parentSession())
    const delegated = (provenance: { parentSessionId: string; toolCallId: string }) =>
      createSession(ctx, 'u1', {
        parentSessionId: 'parent',
        sessionKind: 'subagent',
        sourceToolCallId: 'delegate-1',
        provenance: { kind: 'task-delegation', ...provenance },
      })
    await expect(
      createSession(ctx, 'u1', { parentSessionId: 'parent', sessionKind: 'subagent' }),
    ).rejects.toMatchObject({ code: 'invalid_subagent_origin' })
    await expect(
      delegated({ parentSessionId: 'other', toolCallId: 'delegate-1' }),
    ).rejects.toMatchObject({ code: 'invalid_subagent_origin' })
    await expect(
      delegated({ parentSessionId: 'parent', toolCallId: 'another-call' }),
    ).rejects.toMatchObject({ code: 'invalid_subagent_origin' })
    // Parent and delegating call are the whole requirement — no plugin record id is needed.
    await expect(
      delegated({ parentSessionId: 'parent', toolCallId: 'delegate-1' }),
    ).resolves.toBeDefined()
  })
})
