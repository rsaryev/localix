import { describe, expect, test } from 'bun:test'
import { createWatchedSessionsReconciler } from './reconnect-watched'

interface Session {
  id: string
  bodyLoaded?: boolean
  version: number
}

function harness(sessions: Session[], watched: string[], active: string | null) {
  const store = new Map(sessions.map((session) => [session.id, session]))
  const fetched: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  const reconcile = createWatchedSessionsReconciler<Session>({
    watchedIds: () => watched,
    activeId: () => active,
    getSession: (id) => store.get(id),
    fetchSession: async (id) => {
      fetched.push(id)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return { id, version: (store.get(id)?.version ?? 0) + 1 }
    },
    applySession: (session) => store.set(session.id, session),
  })
  return { store, fetched, reconcile, maxInFlight: () => maxInFlight }
}

describe('reconnect resync of watched background sessions', () => {
  // A grid tab streaming when the API restarted never receives the live-only frames that would
  // finish its body; only the active session used to be refetched.
  test('refetches every watched background session, one at a time', async () => {
    const h = harness(
      [
        { id: 'active', version: 1 },
        { id: 'grid-a', bodyLoaded: true, version: 1 },
        { id: 'grid-b', bodyLoaded: true, version: 1 },
      ],
      ['active', 'grid-a', 'grid-b'],
      'active',
    )
    await h.reconcile()
    // The active session is its own reconcile's job (with the failure toast).
    expect(h.fetched).toEqual(['grid-a', 'grid-b'])
    expect(h.store.get('grid-a')?.version).toBe(2)
    expect(h.store.get('grid-b')?.version).toBe(2)
    expect(h.maxInFlight()).toBe(1)
  })

  test('skips summaries and unknown sessions — nothing half-streamed to repair', async () => {
    const h = harness(
      [
        { id: 'active', version: 1 },
        { id: 'summary', bodyLoaded: false, version: 1 },
      ],
      ['active', 'summary', 'not-in-store'],
      'active',
    )
    await h.reconcile()
    expect(h.fetched).toEqual([])
  })

  test('does nothing while no session is active, so a repair never steals the focus', async () => {
    const h = harness([{ id: 'grid-a', bodyLoaded: true, version: 1 }], ['grid-a'], null)
    await h.reconcile()
    expect(h.fetched).toEqual([])
  })

  test('a newer reconnect supersedes the walk instead of running beside it', async () => {
    const h = harness(
      [
        { id: 'active', version: 1 },
        { id: 'grid-a', bodyLoaded: true, version: 1 },
        { id: 'grid-b', bodyLoaded: true, version: 1 },
      ],
      ['active', 'grid-a', 'grid-b'],
      'active',
    )
    const first = h.reconcile()
    const second = h.reconcile()
    await Promise.all([first, second])
    // The first walk's grid-a read was already in flight; its apply is dropped and the second
    // walk reads each session once.
    expect(h.fetched).toEqual(['grid-a', 'grid-a', 'grid-b'])
    expect(h.store.get('grid-a')?.version).toBe(2)
  })
})
