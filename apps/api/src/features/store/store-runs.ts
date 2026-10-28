import {
  isActiveJob,
  type Listing,
  type StoreActor,
  type StoreProblem,
  type StoreProvider,
} from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'
import { createProviderSync, type SyncOutcome } from './store-sync'

/**
 * WHEN THE STORE INDEX IS WRITTEN (`docs/internals/store-scale.md`, "Sync"). A provider's or a
 * relayed notice's word that something moved marks every person's index dirty and starts a sync
 * in the background — one at a time per person, a word heard meanwhile runs it once more — so a
 * request never waits on a re-index. Only the very first read of an empty index waits for it.
 * Subscribers hear of a sync that changed something once it is written: that is the `store`
 * poke, and clients read the fresh index.
 *
 * The sources are not in the index: a source write announces them at once (`announceSources`),
 * and a source that moved on its own is found after a sync by comparing what they look like now
 * with what they looked like then, so a client that shows them reads again either way.
 */
export function createStoreSync(deps: {
  providers: readonly StoreProvider[]
  index: StoreIndexRepository
  now: () => number
  onSynced?: (outcome: SyncOutcome) => void
  /** What the sources look like now, as one string: equal text, nothing moved. */
  sourcesSignature?: () => Promise<string>
}) {
  const sync = createProviderSync({ index: deps.index, now: deps.now })
  const listeners = new Set<() => void>()
  const sourceListeners = new Set<() => void>()
  let lastSources: string | null = null
  const people = new Map<
    string,
    { actor: StoreActor; running: Promise<void> | null; dirty: boolean; problems: StoreProblem[] }
  >()
  /** Whether the index file held listings when this process first read it. */
  let hasIndexed: Promise<boolean> | null = null

  const personOf = (actor: StoreActor) => {
    let person = people.get(actor.userId)
    if (!person) {
      person = { actor: { userId: actor.userId }, running: null, dirty: true, problems: [] }
      people.set(actor.userId, person)
    }
    return person
  }

  const announceSources = () => {
    for (const listener of sourceListeners) listener()
  }

  async function checkSources() {
    const now = await deps.sourcesSignature?.().catch(() => null)
    if (now == null) return
    const moved = lastSources !== null && lastSources !== now
    lastSources = now
    if (moved) announceSources()
  }

  async function syncAll(person: ReturnType<typeof personOf>) {
    const outcomes = await Promise.all(
      deps.providers.map((provider) => sync(provider, person.actor)),
    )
    const problems = outcomes.flatMap((outcome) => outcome.problems)
    // What could not be read is on the lists too: a source that is read again, or removed, moves
    // nothing in the index (it had no listings), yet the line saying it must go.
    const problemsMoved = JSON.stringify(problems) !== JSON.stringify(person.problems)
    person.problems = problems
    const merged: SyncOutcome = {
      cardsChanged: outcomes.some((outcome) => outcome.cardsChanged),
      changed: problemsMoved || outcomes.some((outcome) => outcome.changed),
      problems,
    }
    deps.onSynced?.(merged)
    if (merged.changed) for (const listener of listeners) listener()
    await checkSources()
  }

  function kick(person: ReturnType<typeof personOf>): Promise<void> {
    if (person.running) {
      person.dirty = true
      return person.running
    }
    person.dirty = false
    const run = syncAll(person)
      .catch(() => undefined)
      .finally(() => {
        person.running = null
        if (person.dirty) void kick(person)
      })
    person.running = run
    return run
  }

  return {
    /**
     * The person's index can be read: the first time with nothing indexed, after a sync; else at
     * once, a sync started in the background when something moved since the last one.
     */
    ready: async (actor: StoreActor): Promise<void> => {
      const fresh = !people.has(actor.userId)
      const person = personOf(actor)
      if (!person.dirty && !person.running) return
      hasIndexed ??= deps.index.count().then((count) => count > 0)
      const run = kick(person)
      if (fresh && !(await hasIndexed)) await run
    },

    /** Re-read every provider for this person now, and wait for it to be written. */
    syncNow: async (actor: StoreActor): Promise<void> => {
      const person = personOf(actor)
      await person.running
      person.dirty = true
      await kick(person)
    },

    /** Something moved: everyone's index is synced again, off the request path. */
    invalidate: () => {
      for (const person of people.values()) {
        person.dirty = true
        void kick(person)
      }
    },

    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** A source was written: those who show the sources read them again. */
    announceSources,

    subscribeSources: (listener: () => void): (() => void) => {
      sourceListeners.add(listener)
      return () => sourceListeners.delete(listener)
    },

    settled: async (): Promise<void> => {
      const running = () => [...people.values()].flatMap((person) => person.running ?? [])
      while (running().length > 0) await Promise.all(running())
    },

    problems: (actor: StoreActor) => personOf(actor).problems,

    busy: (listing: Listing) => isActiveJob(listing.job),
  }
}

export function watchProviders(
  providers: readonly StoreProvider[],
  onChange: () => void,
): () => void {
  const stops = providers.map((provider) => provider.subscribe(onChange))
  return () => {
    for (const stop of stops) stop()
  }
}
