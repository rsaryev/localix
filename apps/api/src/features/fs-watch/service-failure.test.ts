import { describe, expect, test } from 'bun:test'
import { createFileWatchService, type WatcherFactory } from './service'
import type { SessionStreamRegistry } from '../chat/runtime/session-stream-registry'
import type { AgentStreamEvent } from '../chat/contracts'

/**
 * A watcher factory whose watchers can fail — synchronously while being created (no addon for
 * the platform) or later at runtime (a backend error after the root went live).
 */
function failingWatchers(opts: { failOnCreate?: boolean } = {}) {
  let created = 0
  let onError: ((err: unknown) => void) | undefined
  let onChange: ((dirs: string[] | null) => void) | undefined
  const factory: WatcherFactory = (_root, change, o) => {
    created++
    onChange = change
    onError = o?.onError
    if (opts.failOnCreate) o?.onError?.(new Error('no native file watcher'))
    return { close() {} }
  }
  return {
    factory,
    created: () => created,
    failNow: () => onError?.(new Error('backend failed')),
    fire: (dirs: string[] | null) => onChange?.(dirs),
  }
}

function setup(watchers: ReturnType<typeof failingWatchers>, local = true) {
  const events: AgentStreamEvent[] = []
  let clock = 0
  const svc = createFileWatchService({
    streamRegistry: {
      publish: (_u: string, _s: string, event: AgentStreamEvent) => events.push(event),
    } as unknown as SessionStreamRegistry,
    createWatcher: watchers.factory,
    resolveRoot: async () => ({ root: '/repo', local }),
    now: () => clock,
  })
  return { svc, events, advance: (ms: number) => (clock += ms) }
}

describe('file watch: what the tree is told and how a watcher comes back', () => {
  test('arm answers whether the tree is live', async () => {
    expect(await setup(failingWatchers()).svc.arm('u', 's')).toBe(true)
    expect(await setup(failingWatchers(), false).svc.arm('u', 's')).toBe(false)
  })

  // Registering a watcher that failed while being created would make every later arm take it
  // for a live one: no retry, and a tree claiming to be live that never hears a change.
  test('a watcher that fails while being created is not registered, and is retried later', async () => {
    const watchers = failingWatchers({ failOnCreate: true })
    const { svc, advance } = setup(watchers)

    expect(await svc.arm('u', 's')).toBe(false)
    expect(svc.size()).toBe(0)

    // Inside the backoff a listing does not spawn another failing watcher …
    expect(await svc.arm('u', 's')).toBe(false)
    expect(watchers.created()).toBe(1)

    // … after it, the next listing tries again.
    advance(1_000)
    await svc.arm('u', 's')
    expect(watchers.created()).toBe(2)
  })

  test('a runtime failure asks the sessions to reload once and backs off before re-arming', async () => {
    const watchers = failingWatchers()
    const { svc, events, advance } = setup(watchers)
    await svc.arm('u', 's')

    watchers.failNow()
    // The coarse signal: whatever happened while the watcher was failing gets re-read.
    expect(events).toEqual([{ type: 'fs.changed', sessionId: 's', paths: [] }])
    expect(svc.size()).toBe(0)

    // The re-list that signal causes lands inside the backoff: the tree is told it is not live.
    expect(await svc.arm('u', 's')).toBe(false)
    expect(watchers.created()).toBe(1)

    advance(1_000)
    expect(await svc.arm('u', 's')).toBe(true)
    expect(watchers.created()).toBe(2)
  })

  test('the backoff doubles while failures repeat and resets once the watcher delivers', async () => {
    const watchers = failingWatchers()
    const { svc, advance } = setup(watchers)
    await svc.arm('u', 's')

    watchers.failNow() // 1st failure → 1s
    advance(1_000)
    await svc.arm('u', 's')
    watchers.failNow() // 2nd failure → 2s
    advance(1_000)
    expect(await svc.arm('u', 's')).toBe(false)
    advance(1_000)
    expect(await svc.arm('u', 's')).toBe(true)

    watchers.fire(['/repo/src']) // healthy again
    watchers.failNow() // a fresh failure starts the backoff from 1s
    advance(1_000)
    expect(await svc.arm('u', 's')).toBe(true)
  })
})
