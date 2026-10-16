import { describe, expect, test } from 'bun:test'
import {
  inspectorRequestToEffects,
  type GridBusEffect,
  workItemIdMatchesPrefix,
} from './inspectorBusMapping'

/**
 * Narrow to an `open` effect AND assert it. Every case below used to read
 * `if (eff.type === 'open') { expect(…) }`, which runs ZERO assertions when the
 * mapper returns anything else — so the very regression these tests guard (an
 * inspector request that stops producing an open, or renames the discriminant)
 * would pass green. Asserting inside the narrowing puts the shape in the guard.
 */
function asOpen(eff: GridBusEffect): Extract<GridBusEffect, { type: 'open' }> {
  expect(eff.type).toBe('open')
  if (eff.type !== 'open') throw new Error(`expected an open effect, got ${eff.type}`)
  return eff
}

describe('workItemIdMatchesPrefix', () => {
  test('matches an exact tab and colon-delimited children without prefix collisions', () => {
    expect(workItemIdMatchesPrefix('db-console:abc', 'db-console:abc')).toBe(true)
    expect(workItemIdMatchesPrefix('db-console:abc:second', 'db-console:abc')).toBe(true)
    expect(workItemIdMatchesPrefix('db-console:abc2', 'db-console:abc')).toBe(false)
  })

  test('a session closes that chat’s session tab and never the same id in another chat', () => {
    const s1 = { session: 's1' }
    expect(workItemIdMatchesPrefix('acme:task:LX-3@s1', 'acme:task:LX-3', s1)).toBe(true)
    expect(workItemIdMatchesPrefix('acme:task:LX-3@s2', 'acme:task:LX-3', s1)).toBe(false)
    expect(workItemIdMatchesPrefix('acme:task:LX-30@s1', 'acme:task:LX-3', s1)).toBe(false)
    // Positive control for the defect: without the session a session tab is unreachable.
    expect(workItemIdMatchesPrefix('acme:task:LX-3@s1', 'acme:task:LX-3')).toBe(false)
  })

  test('everyChat closes the tab in every chat, reading the suffix from the tab’s own scope', () => {
    // An app-wide thing that went away (a removed connection) used to close only in the chat
    // that removed it; the other chats kept tabs pointing at nothing.
    const every = (itemScope: string) => ({ everyChat: true, itemScope })
    expect(workItemIdMatchesPrefix('db:console:p@s1', 'db:console:p', every('s1'))).toBe(true)
    expect(workItemIdMatchesPrefix('db:console:p@s2', 'db:console:p', every('s2'))).toBe(true)
    expect(workItemIdMatchesPrefix('db:console:p:x@s2', 'db:console:p', every('s2'))).toBe(true)
    expect(workItemIdMatchesPrefix('db:console:p2@s1', 'db:console:p', every('s1'))).toBe(false)
    // The suffix is the tab's scope, never parsed from the id: an `@` that is not the scope stays.
    expect(workItemIdMatchesPrefix('db:console:p@s1', 'db:console:p', every('s9'))).toBe(false)
  })

  test('supports raw family prefixes that already end in a delimiter', () => {
    expect(workItemIdMatchesPrefix('db-table:abc:public:users', 'db-table:abc:')).toBe(true)
    expect(workItemIdMatchesPrefix('db-table:abc2:public:users', 'db-table:abc:')).toBe(false)
  })
})

// The mapper takes no "active session": every id and scope below comes from the REQUEST. It used
// to fill a request that named no chat with the focused one, which put one chat's file in
// another chat's workspace.
describe('inspectorRequestToEffects', () => {
  test("file → ephemeral open, keyed and scoped by the request's own chat", () => {
    const [eff] = inspectorRequestToEffects({
      kind: 'file',
      sessionId: 's1',
      path: 'src/a.ts',
      line: 4,
      ephemeral: true,
    })
    expect(eff).toMatchObject({ type: 'open', ephemeral: true })
    const open = asOpen(eff)
    expect(open.item.id).toBe('file:s1:src/a.ts')
    expect(open.item.scope).toBe('s1')
    expect(open.item.kind).toBe('file')
    expect(open.item.payload).toMatchObject({ path: 'src/a.ts', line: 4 })
  })

  test('file/diff are keyed + scoped PER SESSION (same path in two sessions = two tabs)', () => {
    const a = asOpen(
      inspectorRequestToEffects({ kind: 'file', sessionId: 's1', path: 'src/a.ts' })[0],
    )
    const b = asOpen(
      inspectorRequestToEffects({ kind: 'file', sessionId: 's2', path: 'src/a.ts' })[0],
    )
    expect(a.item.id).toBe('file:s1:src/a.ts')
    expect(a.item.scope).toBe('s1')
    expect(b.item.id).toBe('file:s2:src/a.ts') // distinct tab, not a shared one
    expect(b.item.scope).toBe('s2')
    const d = asOpen(
      inspectorRequestToEffects({ kind: 'diff', sessionId: 's1', path: 'src/a.ts', diff: '@@' })[0],
    )
    expect(d.item.id).toBe('diff:s1:src/a.ts')
    expect(d.item.scope).toBe('s1')
  })

  test('a stored media file is keyed by its id within its chat', () => {
    const m = asOpen(
      inspectorRequestToEffects({
        kind: 'media-file',
        sessionId: 's2',
        mediaId: 'm1',
        name: 'a.pdf',
      })[0],
    )
    expect(m.item.id).toBe('file:media:s2:m1')
    expect(m.item.scope).toBe('s2')
    expect(m.item.title).toBe('a.pdf')
  })

  test("the chat's singleton panels are scoped by the request; the store qualifies their id", () => {
    const preview = asOpen(
      inspectorRequestToEffects({
        kind: 'preview',
        url: 'http://x',
        version: 1,
        sessionId: 's1',
      })[0],
    )
    expect(preview.item).toMatchObject({ id: 'preview', scope: 's1' })
    const activity = asOpen(
      inspectorRequestToEffects({ kind: 'message-replay', sessionId: 's2', messageId: 'm' })[0],
    )
    expect(activity.item).toMatchObject({ id: 'message-replay', scope: 's2' })
  })

  test("a work item keeps the opener's scope, and an app-level one (null) carries none", () => {
    const scoped = asOpen(
      inspectorRequestToEffects({
        kind: 'work-item',
        workKind: 'board',
        id: 'board',
        title: 'Board',
        scope: 's1',
      })[0],
    )
    expect(scoped.item.scope).toBe('s1')
    const global = asOpen(
      inspectorRequestToEffects({
        kind: 'work-item',
        workKind: 'agent',
        id: 'agent:x',
        title: 'X',
        scope: null,
      })[0],
    )
    expect(global.item).not.toHaveProperty('scope')
  })

  test('diff carries the conflict apply-action payload through to the WorkItem', () => {
    const conflict = {
      sessionId: 's1',
      editPath: '/abs/a.ts',
      edits: 'mine',
      diskContent: 'theirs',
      diskHash: 'h9',
    }
    const d = asOpen(
      inspectorRequestToEffects({
        kind: 'diff',
        sessionId: 's1',
        path: 'conflict:///abs/a.ts',
        diff: '@@',
        conflict,
      })[0],
    )
    expect(d.item.payload?.conflict).toEqual(conflict)
  })
  test('app-level singletons use fixed ids and belong to no chat', () => {
    const stats = asOpen(inspectorRequestToEffects({ kind: 'stats' })[0])
    expect(stats.item.id).toBe('stats')
    expect(stats.item.scope).toBeUndefined()
  })

  test('terminal emits no pure effect (handled async by the bus hook)', () => {
    expect(inspectorRequestToEffects({ kind: 'terminal', sessionId: 's1' })).toEqual([])
  })

  test("global search is the request's chat's Search tab, seeded with its query and scope", () => {
    const open = asOpen(
      inspectorRequestToEffects({
        kind: 'global-search',
        sessionId: 's1',
        query: 'state mismatch',
        scope: 'files',
      })[0],
    )
    expect(open.item.scope).toBe('s1')
    expect(open.item.payload).toEqual({ query: 'state mismatch', scope: 'files' })
  })

  test('close-preview / clear-live-file-change → close effects; close-session → free the scope', () => {
    // The Browser is one tab per chat, so closing chat s1's never names another chat's.
    expect(inspectorRequestToEffects({ kind: 'close-preview', sessionId: 's1' })).toEqual([
      { type: 'close', id: 'preview@s1' },
    ])
    expect(
      inspectorRequestToEffects({ kind: 'clear-live-file-change', toolCallId: 'tc1' }),
    ).toEqual([{ type: 'close', id: 'live:tc1' }])
    // Its chat tab too: a sub-session has no scope of its own, its chat tab lives in its root's.
    expect(inspectorRequestToEffects({ kind: 'close-session', sessionId: 's1' })).toEqual([
      { type: 'close-scope', scope: 's1' },
      { type: 'close', id: 'chat:s1' },
    ])
  })
})
