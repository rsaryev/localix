import { describe, expect, test } from 'bun:test'
import { createFileWatchService, type WatcherFactory } from './service'
import type { FsChange } from './watcher'
import type { SessionStreamRegistry } from '../chat/runtime/session-stream-registry'
import type { AgentStreamEvent } from '../chat/contracts'

/** Fake watcher factory: records each created watcher and lets a test fire a change. */
function fakeWatchers() {
  const live = new Map<string, { onChange: (dirs: string[] | null) => void; closed: boolean }>()
  const factory: WatcherFactory = (root, onChange) => {
    live.set(root, { onChange, closed: false })
    return {
      close() {
        const w = live.get(root)
        if (w) w.closed = true
      },
    }
  }
  return {
    factory,
    /** Fire a settled change for a root (no-op if no live watcher). */
    fire(root: string, dirs: string[] | null) {
      live.get(root)?.onChange(dirs)
    },
    isClosed: (root: string) => live.get(root)?.closed ?? true,
    count: () => [...live.values()].filter((w) => !w.closed).length,
  }
}

/** Capturing stream registry — only `publish` is exercised. */
function fakeRegistry() {
  const events: { sessionId: string; event: AgentStreamEvent }[] = []
  const registry = {
    publish: (_userId: string, sessionId: string, event: AgentStreamEvent) =>
      events.push({ sessionId, event }),
  } as unknown as SessionStreamRegistry
  return { registry, events }
}

describe('createFileWatchService', () => {
  test('two sessions sharing a root use ONE watcher and both get the change', async () => {
    const w = fakeWatchers()
    const { registry, events } = fakeRegistry()
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: w.factory,
      resolveRoot: async () => ({ root: '/repo', local: true }),
    })

    await svc.arm('u1', 'owner')
    await svc.arm('u1', 'reviewer') // shares the same directory
    expect(svc.size()).toBe(1)

    w.fire('/repo', ['/repo/src'])
    const sessions = events.map((e) => e.sessionId).sort()
    expect(sessions).toEqual(['owner', 'reviewer'].sort())
    expect(events[0]?.event).toMatchObject({ type: 'fs.changed', paths: ['/repo/src'] })
  })

  test('coarse signal (null) publishes an empty paths array', async () => {
    const w = fakeWatchers()
    const { registry, events } = fakeRegistry()
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: w.factory,
      resolveRoot: async () => ({ root: '/repo', local: true }),
    })
    await svc.arm('u1', 's1')
    w.fire('/repo', null)
    expect(events[0]?.event).toMatchObject({ type: 'fs.changed', paths: [] })
  })

  // The changed entries are what a language server needs; they reach the host's
  // `onRootChanged` beside the per-session `fs.changed` frames, and `null` (unknown) stays null.
  test('onRootChanged receives the changed entries, or null when unknown', async () => {
    const live = new Map<string, (dirs: string[] | null, changes?: FsChange[] | null) => void>()
    const { registry } = fakeRegistry()
    const heard: { root: string; changes: FsChange[] | null }[] = []
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: (root, onChange) => {
        live.set(root, onChange)
        return { close() {} }
      },
      resolveRoot: async () => ({ root: '/repo', local: true }),
      onRootChanged: (root, changes) => heard.push({ root, changes }),
    })
    await svc.arm('u1', 's1')
    const changes: FsChange[] = [{ path: '/repo/src/a.ts', type: 'update' }]
    live.get('/repo')?.(['/repo/src'], changes)
    live.get('/repo')?.(null, null)
    live.get('/repo')?.(['/repo/src']) // a watcher that does not report entries
    expect(heard).toEqual([
      { root: '/repo', changes },
      { root: '/repo', changes: null },
      { root: '/repo', changes: null },
    ])
  })

  test('watcher closes only when its LAST sharing session is released', async () => {
    const w = fakeWatchers()
    const { registry } = fakeRegistry()
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: w.factory,
      resolveRoot: async () => ({ root: '/repo', local: true }),
    })
    await svc.arm('u1', 'a')
    await svc.arm('u1', 'b')

    svc.release('a')
    expect(w.isClosed('/repo')).toBe(false)
    expect(svc.size()).toBe(1)

    svc.release('b')
    expect(w.isClosed('/repo')).toBe(true)
    expect(svc.size()).toBe(0)
  })

  test('non-local sessions are never watched', async () => {
    const w = fakeWatchers()
    const { registry } = fakeRegistry()
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: w.factory,
      resolveRoot: async () => ({ root: '/remote', local: false }),
    })
    await svc.arm('u1', 'ssh-session')
    expect(svc.size()).toBe(0)
  })

  test('LRU cap evicts the least-recently-armed root', async () => {
    const w = fakeWatchers()
    const { registry } = fakeRegistry()
    const roots: Record<string, string> = { a: '/repo-a', b: '/repo-b' }
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: w.factory,
      maxRoots: 1,
      resolveRoot: async (_u, sid) => ({ root: roots[sid]!, local: true }),
    })
    await svc.arm('u1', 'a')
    await svc.arm('u1', 'b') // exceeds cap → /repo-a evicted
    expect(svc.size()).toBe(1)
    expect(w.isClosed('/repo-a')).toBe(true)
    expect(w.isClosed('/repo-b')).toBe(false)
  })

  test('a released session no longer receives changes', async () => {
    const w = fakeWatchers()
    const { registry, events } = fakeRegistry()
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: w.factory,
      resolveRoot: async () => ({ root: '/repo', local: true }),
    })
    await svc.arm('u1', 'a')
    await svc.arm('u1', 'b')
    svc.release('a')
    w.fire('/repo', ['/repo/x'])
    expect(events.map((e) => e.sessionId)).toEqual(['b'])
  })

  // A session's root is not fixed: `resolveSessionWorkingDir` lets a provisioned git
  // session's project change under it, and `arm` re-runs on every tree listing.
  test('a session that MOVES to another root stops hearing from the old one', async () => {
    const w = fakeWatchers()
    const { registry, events } = fakeRegistry()
    let root = '/repo'
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: w.factory,
      resolveRoot: async () => ({ root, local: true }),
    })

    await svc.arm('u1', 's1')
    root = '/repo-wt' // the session's directory moved
    await svc.arm('u1', 's1')

    // The abandoned root must be gone: `s1` was its only session, and `release('s1')`
    // can never reach it again — `sessionRoot` now points at the new root.
    expect(svc.size()).toBe(1)
    expect(w.isClosed('/repo')).toBe(true)

    // The bite: a change in the directory the session LEFT used to reload its tree.
    w.fire('/repo', ['/repo/src'])
    expect(events).toEqual([])

    // And the new root still works.
    w.fire('/repo-wt', ['/repo-wt/src'])
    expect(events.map((e) => e.sessionId)).toEqual(['s1'])
  })

  test('a move does NOT close a root another session still shares', async () => {
    // The reverse direction: detaching the mover must not evict its former co-tenants.
    const w = fakeWatchers()
    const { registry, events } = fakeRegistry()
    const roots: Record<string, string> = { mover: '/repo', stayer: '/repo' }
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: w.factory,
      resolveRoot: async (_u, sessionId) => ({ root: roots[sessionId], local: true }),
    })

    await svc.arm('u1', 'stayer')
    await svc.arm('u1', 'mover')
    roots.mover = '/repo-wt'
    await svc.arm('u1', 'mover')

    expect(w.isClosed('/repo')).toBe(false)
    w.fire('/repo', ['/repo/src'])
    expect(events.map((e) => e.sessionId)).toEqual(['stayer'])
  })

  test('re-arming the SAME root is still idempotent', async () => {
    // The other reverse direction: the detach must not fire on a plain re-arm, or every
    // tree listing would tear down and respawn the watcher it just used.
    const w = fakeWatchers()
    const { registry } = fakeRegistry()
    const svc = createFileWatchService({
      streamRegistry: registry,
      createWatcher: w.factory,
      resolveRoot: async () => ({ root: '/repo', local: true }),
    })

    await svc.arm('u1', 's1')
    await svc.arm('u1', 's1')
    expect(svc.size()).toBe(1)
    expect(w.isClosed('/repo')).toBe(false)
  })
})
