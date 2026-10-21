import { beforeEach, describe, expect, test } from 'bun:test'

import type { UiSession } from '@/shared/api/contracts'
import type { ChatStore } from './store'
import {
  applyStreamEventPatch,
  clearLiveSessionBodies,
  getLiveSessionBody,
  patchSessionById,
  compareSessions,
  isEmptyDraftSession,
  mergeSessionState,
  pruneFinishedSubSessions,
  sortSessions,
} from './sessionListHelpers'

beforeEach(clearLiveSessionBodies)

/** Minimal UiSession for these pure list helpers (they read only a few fields). */
function mk(o: Partial<UiSession>): UiSession {
  return {
    id: 'x',
    title: 'New Chat',
    sessionKind: 'chat',
    parentSessionId: null,
    isRunning: false,
    messages: [],
    messageCount: 0,
    isPinned: false,
    updatedAt: 0,
    projectId: null,
    ...o,
  } as UiSession
}

describe('isEmptyDraftSession', () => {
  test('a fresh untouched New Chat is an empty draft', () => {
    expect(isEmptyDraftSession(mk({}))).toBe(true)
    expect(isEmptyDraftSession(mk({ title: '   ' }))).toBe(true)
  })
  test('not a draft once it has messages, a custom title, runs, or is a fork/worker', () => {
    expect(isEmptyDraftSession(mk({ messages: [{} as never] }))).toBe(false)
    expect(isEmptyDraftSession(mk({ title: 'Deploy staging' }))).toBe(false)
    expect(isEmptyDraftSession(mk({ isRunning: true }))).toBe(false)
    expect(isEmptyDraftSession(mk({ parentSessionId: 'p' }))).toBe(false)
    expect(isEmptyDraftSession(mk({ sessionKind: 'subagent' }))).toBe(false)
    expect(isEmptyDraftSession(mk({ sessionKind: 'job' }))).toBe(false)
  })
  test('a used chat whose body is not loaded is not a draft', () => {
    // A list row / an evicted body: `messages` is empty, the persisted count is not.
    // Reading only `messages` sent New chat into old chats still titled "New Chat".
    expect(isEmptyDraftSession(mk({ messageCount: 4 }))).toBe(false)
    expect(
      isEmptyDraftSession(
        mk({ messageCount: 2, messages: [{ role: 'system' } as never], bodyLoaded: false }),
      ),
    ).toBe(false)
  })
  test('a client notice alone does not make an untouched draft used', () => {
    expect(
      isEmptyDraftSession(mk({ messageCount: 0, messages: [{ role: 'system' } as never] })),
    ).toBe(true)
    expect(isEmptyDraftSession(mk({ messages: [{ role: 'user' } as never] }))).toBe(false)
  })
})

describe('mergeSessionState — large roster streaming mirror', () => {
  test('does not touch a 100k-session roster for a token delta', () => {
    const allSessions = Array.from({ length: 100_000 }, (_, index) =>
      mk({ id: `session-${index}`, projectId: index === 50_000 ? 'active' : 'other' }),
    )
    const active = {
      ...allSessions[50_000]!,
      messages: [{ id: 'live', role: 'assistant', content: 'a' } as never],
    }
    const sessions = [active]
    allSessions[50_000] = active

    const patch = applyStreamEventPatch(
      { sessions, allSessions, _liveSessionRevision: 0 },
      active.id,
      {
        type: 'message.delta',
        sessionId: active.id,
        messageId: 'live',
        contentAppend: 'b',
      } as never,
    )

    expect(patch).toEqual({ _liveSessionRevision: 1 })
    expect(patch.sessions).toBeUndefined()
    expect(patch.allSessions).toBeUndefined()
    expect(getLiveSessionBody(active.id)?.messages[0]?.content).toBe('ab')
  })

  test('replaces only the changed active object in a 100k-session roster', () => {
    const allSessions = Array.from({ length: 100_000 }, (_, index) =>
      mk({ id: `session-${index}`, projectId: index === 50_000 ? 'active' : 'other' }),
    )
    const current = allSessions[50_000]!
    const updated = { ...current, messages: [{ id: 'tail', role: 'assistant' }] as never }
    const state = {
      activeProjectId: 'active',
      sessions: [current],
      allSessions,
    } as unknown as ChatStore

    const merged = mergeSessionState(state, { sessions: [updated] })

    expect(merged.allSessions).not.toBe(allSessions)
    expect(merged.allSessions?.[50_000]).toBe(updated)
    expect(merged.allSessions?.[49_999]).toBe(allSessions[49_999])
    expect(merged.allSessions?.[50_001]).toBe(allSessions[50_001])
  })
})

describe('compareSessions / sortSessions', () => {
  test('pinned sort before unpinned; otherwise newest-updated first', () => {
    const pinnedOld = mk({ id: 'a', isPinned: true, updatedAt: 1 })
    const freshUnpinned = mk({ id: 'b', isPinned: false, updatedAt: 100 })
    expect(compareSessions(pinnedOld, freshUnpinned)).toBeLessThan(0) // pinned first
    const older = mk({ id: 'c', updatedAt: 1 })
    const newer = mk({ id: 'd', updatedAt: 2 })
    expect(compareSessions(newer, older)).toBeLessThan(0) // newer first
  })

  test('returns the SAME array reference when already ordered (stream fast path)', () => {
    const ordered = [
      mk({ id: 'a', updatedAt: 3 }),
      mk({ id: 'b', updatedAt: 2 }),
      mk({ id: 'c', updatedAt: 1 }),
    ]
    expect(sortSessions(ordered)).toBe(ordered)
  })

  test('returns a new, sorted array when out of order', () => {
    const unordered = [mk({ id: 'old', updatedAt: 1 }), mk({ id: 'new', updatedAt: 9 })]
    const sorted = sortSessions(unordered)
    expect(sorted).not.toBe(unordered)
    expect(sorted.map((s) => s.id)).toEqual(['new', 'old'])
  })
})

describe('mergeSessionState', () => {
  test('a non-list write keeps BOTH list references (no phantom identity churn)', () => {
    // Every store write funnels through mergeSessionState. A write that never
    // touched the session lists (connections, queue, HITL inbox, a no-op stream
    // tick) must hand subscribers the SAME arrays — a fresh `filter()` here is
    // what made every mounted surface re-derive on every commit.
    const allSessions = [mk({ id: 'a', projectId: 'p1' }), mk({ id: 'b', projectId: 'p2' })]
    const sessions = [allSessions[0]]
    const state = { allSessions, sessions, activeProjectId: 'p1' } as unknown as ChatStore
    const out = mergeSessionState(state, { connections: [] } as unknown as Partial<ChatStore>)
    expect(out.allSessions).toBe(allSessions)
    expect(out.sessions).toBe(sessions)
  })

  test('replacing allSessions re-derives the project-filtered, sorted view', () => {
    const state = { allSessions: [], sessions: [], activeProjectId: 'p1' } as unknown as ChatStore
    const next = {
      allSessions: [
        mk({ id: 'a', projectId: 'p1', updatedAt: 1 }),
        mk({ id: 'b', projectId: 'p2', updatedAt: 5 }),
        mk({ id: 'c', projectId: 'p1', updatedAt: 9 }),
      ],
    }
    const out = mergeSessionState(state, next)
    expect(out.allSessions).toHaveLength(3)
    // Only p1 sessions, newest first.
    expect(out.sessions?.map((s) => s.id)).toEqual(['c', 'a'])
    expect(out.activeProjectId).toBe('p1')
  })
})

describe('pruneFinishedSubSessions', () => {
  const worker = (id: string, host: string, updatedAt: number, running = false) =>
    mk({ id, sessionKind: 'subagent', parentSessionId: host, isRunning: running, updatedAt })

  test('keeps chats, running sub-sessions, and the most recent N finished per host', () => {
    const chats = [mk({ id: 'chat-a' }), mk({ id: 'chat-b' })]
    const finished = Array.from({ length: 30 }, (_, i) => worker(`w${i}`, 'chat-a', i))
    const running = worker('live', 'chat-a', 999, true)
    const pruned = pruneFinishedSubSessions([...chats, running, ...finished], 25)

    // both chats + the running worker always survive
    expect(pruned.find((s) => s.id === 'chat-a')).toBeDefined()
    expect(pruned.find((s) => s.id === 'chat-b')).toBeDefined()
    expect(pruned.find((s) => s.id === 'live')).toBeDefined()
    // only the 25 newest finished workers remain (w5..w29); w0..w4 evicted
    const keptFinished = pruned.filter((s) => s.sessionKind === 'subagent' && !s.isRunning)
    expect(keptFinished).toHaveLength(25)
    expect(pruned.find((s) => s.id === 'w0')).toBeUndefined()
    expect(pruned.find((s) => s.id === 'w29')).toBeDefined()
  })

  test('caps are per host, not global', () => {
    const a = Array.from({ length: 20 }, (_, i) => worker(`a${i}`, 'chat-a', i))
    const b = Array.from({ length: 20 }, (_, i) => worker(`b${i}`, 'chat-b', i))
    const pruned = pruneFinishedSubSessions([...a, ...b], 25)
    expect(pruned).toHaveLength(40) // neither host exceeds 25
  })

  test('returns the same reference when nothing is evicted', () => {
    const list = [mk({ id: 'chat' }), worker('w0', 'chat', 1)]
    expect(pruneFinishedSubSessions(list, 25)).toBe(list)
  })

  test('bounds a delegation-heavy host with 100k finished sub-sessions', () => {
    const root = mk({ id: 'chat' })
    const running = worker('live', 'chat', 100_001, true)
    const finished = Array.from({ length: 100_000 }, (_, index) =>
      worker(`worker-${index}`, 'chat', index),
    )

    const pruned = pruneFinishedSubSessions([root, running, ...finished], 25)

    expect(pruned).toHaveLength(27)
    expect(pruned).toContain(root)
    expect(pruned).toContain(running)
    expect(
      pruned.filter((session) => session.sessionKind === 'subagent' && !session.isRunning),
    ).toHaveLength(25)
    expect(pruned.some((session) => session.id === 'worker-99999')).toBe(true)
    expect(pruned.some((session) => session.id === 'worker-0')).toBe(false)
  })
})

describe('applyStreamEventPatch — diagnostics reach the session that owns the file tab', () => {
  const diag = [
    { line: 0, character: 0, endLine: 0, endCharacter: 1, severity: 'error', message: 'x' },
  ]
  const lspEvent = (sessionId: string, file: string) =>
    ({ type: 'lsp.diagnostics', sessionId, file, diagnostics: diag }) as never

  test('lsp.diagnostics for a session IN the working list lands (via the mirror)', () => {
    const active = mk({ id: 'active', projectId: 'p1' })
    const state = { sessions: [active], allSessions: [active] }
    const patch = applyStreamEventPatch(state, 'active', lspEvent('active', '/a.ts'))
    // Fast path updates `sessions`; mergeSessionState then mirrors into allSessions.
    const updated = patch.sessions?.find((s) => s.id === 'active')
    expect(updated?.lspDiagnostics['/a.ts']).toEqual(diag as never)
    const merged = mergeSessionState(state as never, patch)
    expect(merged.allSessions?.find((s) => s.id === 'active')?.lspDiagnostics['/a.ts']).toEqual(
      diag as never,
    )
  })

  test('lsp.diagnostics for a session NOT in the working list (sub-session / other project) still lands in allSessions', () => {
    // The regression: a worker sub-session (only ever in allSessions) or a
    // session in a different project than the active one. FileTab reads its OWN
    // session out of allSessions by id, so the update MUST reach allSessions.
    const activeChat = mk({ id: 'active', projectId: 'p1' })
    const bgWorker = mk({
      id: 'worker',
      projectId: 'p2',
      sessionKind: 'subagent',
      parentSessionId: 'active',
    })
    const state = { sessions: [activeChat], allSessions: [activeChat, bgWorker] }

    const patch = applyStreamEventPatch(state, 'worker', lspEvent('worker', '/w.ts'))
    // Not touched via `sessions` (worker isn't there) — must be updated in allSessions directly.
    expect(patch.sessions).toBeUndefined()
    expect(patch.allSessions?.find((s) => s.id === 'worker')?.lspDiagnostics['/w.ts']).toEqual(
      diag as never,
    )
    // The active chat's object is untouched.
    expect(patch.allSessions?.find((s) => s.id === 'active')).toBe(activeChat)
  })

  test('an event for an unknown session is a no-op patch', () => {
    const active = mk({ id: 'active', projectId: 'p1' })
    const state = { sessions: [active], allSessions: [active] }
    expect(applyStreamEventPatch(state, 'ghost', lspEvent('ghost', '/g.ts'))).toEqual({})
  })

  test('an event the reducer ignores mints NO new list identity', () => {
    // A message.delta for a message not yet in the store returns the session
    // unchanged; handing subscribers a fresh array for it would re-render every
    // mounted surface for nothing — the multi-stream freeze amplifier.
    const active = mk({ id: 'active', projectId: 'p1' })
    const state = { sessions: [active], allSessions: [active] }
    const ghostDelta = {
      type: 'message.delta',
      sessionId: 'active',
      messageId: 'not-in-store',
      textItemId: 'text-0',
      textAppend: 'x',
    } as never
    expect(applyStreamEventPatch(state, 'active', ghostDelta)).toEqual({})
  })

  test('keeps token deltas out of both roster arrays and commits them on the next snapshot', () => {
    const active = mk({
      id: 'active',
      projectId: 'p1',
      messages: [{ id: 'm1', role: 'assistant', content: 'hello' } as never],
    })
    const state = {
      sessions: [active],
      allSessions: [active],
      _liveSessionRevision: 0,
    }
    const delta = {
      type: 'message.delta',
      sessionId: 'active',
      messageId: 'm1',
      contentAppend: ' world',
    } as never

    const hotPatch = applyStreamEventPatch(state, 'active', delta)

    expect(hotPatch).toEqual({ _liveSessionRevision: 1 })
    expect(getLiveSessionBody('active')?.messages[0]?.content).toBe('hello world')
    expect(state.sessions[0]).toBe(active)
    expect(state.allSessions[0]).toBe(active)

    const committed = applyStreamEventPatch(
      { ...state, _liveSessionRevision: 1 },
      'active',
      lspEvent('active', '/live.ts'),
    )
    expect(committed.sessions?.[0]?.messages[0]?.content).toBe('hello world')
    expect(committed._liveSessionRevision).toBe(2)
    expect(getLiveSessionBody('active')).toBeUndefined()
  })
})

/**
 * The generalisation of the same routing, for the non-hot-path writers. `sessions` is
 * `allSessions` filtered by the active project, so a writer that maps it alone is a
 * silent no-op for a sub-session or a chat in another project — while readers resolve
 * by id out of `allSessions`.
 */
describe('patchSessionById — a flag reaches the session wherever it lives', () => {
  test('a session OUTSIDE the working list is patched in allSessions', () => {
    // THE BUG: a run finishing in another project raised the notification (which names
    // the session via the allSessions fallback) and then set `isUnread` on nothing.
    const other = mk({ id: 'other', projectId: 'p2' })
    const state = { sessions: [], allSessions: [other] }
    const patch = patchSessionById(state as never, 'other', (s) => ({ ...s, isUnread: true }))
    expect(patch.allSessions?.find((s) => s.id === 'other')?.isUnread).toBe(true)
    // The working list is left alone — this session does not belong to it.
    expect(patch.sessions).toBeUndefined()
  })

  test('a session IN the working list is patched there, and the mirror carries it', () => {
    // The reverse direction: the fix must not stop routing through `sessions`, or the
    // streaming path pays a full allSessions rebuild and the working list goes stale.
    const active = mk({ id: 'active', projectId: 'p1' })
    const state = { sessions: [active], allSessions: [active] }
    const patch = patchSessionById(state as never, 'active', (s) => ({ ...s, isUnread: true }))
    expect(patch.sessions?.find((s) => s.id === 'active')?.isUnread).toBe(true)
    const merged = mergeSessionState(state as never, patch)
    expect(merged.allSessions?.find((s) => s.id === 'active')?.isUnread).toBe(true)
  })

  test('an unknown id patches nothing at all', () => {
    // The other over-reach guard: it must not invent an entry in either list.
    const active = mk({ id: 'active', projectId: 'p1' })
    const state = { sessions: [active], allSessions: [active] }
    expect(patchSessionById(state as never, 'ghost', (s) => ({ ...s, isUnread: true }))).toEqual({})
  })
})

describe('mergeSessionState — a writer touching an out-of-scope session must not duplicate it', () => {
  test('a session already in allSessions is UPDATED, never appended a second time', () => {
    // `_replaceSession` prepends into `sessions` when the id isn't there — which is the
    // case for any chat outside the active project (the HITL inbox recovers exactly such
    // sessions: "the waiting session may be in another project"). `addedSessions` was
    // computed against the FILTERED list, so "new to the working list" was mistaken for
    // "new to allSessions", and the merge appended a copy the map had just replaced.
    const p2 = mk({ id: 'other', projectId: 'p2', title: 'old' })
    const p1 = mk({ id: 'mine', projectId: 'p1' })
    const state = { activeProjectId: 'p1', sessions: [p1], allSessions: [p1, p2] }
    const updated = { ...p2, title: 'new' }

    const merged = mergeSessionState(state as never, { sessions: [updated, p1] })

    const copies = (merged.allSessions ?? []).filter((s) => s.id === 'other')
    expect(copies).toHaveLength(1)
    expect(copies[0]?.title).toBe('new')
  })

  test('a genuinely NEW session is still added to allSessions', () => {
    // The reverse direction: without the append, a session created after the snapshot
    // (a plugin's dispatch, a recurring task firing) would never reach the roster at all.
    const p1 = mk({ id: 'mine', projectId: 'p1' })
    const fresh = mk({ id: 'fresh', projectId: 'p1' })
    const state = { activeProjectId: 'p1', sessions: [p1], allSessions: [p1] }

    const merged = mergeSessionState(state as never, { sessions: [fresh, p1] })

    expect((merged.allSessions ?? []).map((s) => s.id).sort()).toEqual(['fresh', 'mine'])
    expect((merged.sessions ?? []).map((s) => s.id).sort()).toEqual(['fresh', 'mine'])
  })

  test('an unresolved scope shows nothing — null is not a wildcard over every project', () => {
    // Null means the workspace has not resolved a project yet (the first frames of a cold
    // launch). Treating it as "everything" is how one project's chats used to leak into
    // another scope's list.
    const other = mk({ id: 'other', projectId: 'p2' })
    const project = mk({ id: 'project', projectId: 'p1' })
    const state = {
      activeProjectId: 'p1',
      sessions: [project],
      allSessions: [project, other],
    }

    const merged = mergeSessionState(state as never, { activeProjectId: null })

    expect(merged.sessions?.map((session) => session.id)).toEqual([])
    expect(merged.allSessions).toEqual([project, other])
  })
})

test('ordinary New chat never reuses an external session with an empty Localix message history', () => {
  expect(isEmptyDraftSession(mk({ externalAgentProvider: 'codex' }))).toBe(false)
  expect(isEmptyDraftSession(mk({}))).toBe(true)
})
