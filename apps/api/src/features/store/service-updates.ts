import type { ListingRef, PackageKind, Scope, StoreActor, StoreProvider } from '@localixai/store'

import { unsupported } from './unsupported'
import type { StoreIndexRepository } from './index-repository'
import type { createStoreSync } from './store-runs'

/** The actions on a source, by provider kind: each announces what it changed. */
export function sourceActions(
  providerOf: (kind: PackageKind) => StoreProvider,
  runs: ReturnType<typeof createStoreSync>,
) {
  return {
    async refreshSource(kind: PackageKind, id: string) {
      const provider = providerOf(kind)
      if (!provider.refreshSource) throw unsupported(kind, 'read one source again')
      await provider.refreshSource(id)
      runs.announceSources()
      runs.invalidate()
    },

    async setSourceAutoUpdate(kind: PackageKind, id: string, on: boolean) {
      const provider = providerOf(kind)
      if (!provider.setSourceAutoUpdate) throw unsupported(kind, 'switch auto-update')
      await provider.setSourceAutoUpdate(id, on)
      runs.announceSources()
    },

    async previewSource(kind: PackageKind, input: string) {
      const provider = providerOf(kind)
      if (!provider.previewSource) throw unsupported(kind, 'add a source')
      return provider.previewSource(input)
    },

    async addSource(kind: PackageKind, input: string) {
      const provider = providerOf(kind)
      if (!provider.addSource) throw unsupported(kind, 'add a source')
      await provider.addSource(input)
      runs.announceSources()
    },

    async removeSource(kind: PackageKind, id: string) {
      const provider = providerOf(kind)
      if (!provider.removeSource) throw unsupported(kind, 'remove a source')
      await provider.removeSource(id)
      runs.announceSources()
    },
  }
}

/**
 * Update all: every provider re-reads its sources (one that cannot keeps what it had), then
 * each install a newer version is offered for is updated, unless a job already runs for it.
 * Returns what was queued.
 */
export async function applyUpdates(
  deps: {
    providers: readonly StoreProvider[]
    index: StoreIndexRepository
    runs: ReturnType<typeof createStoreSync>
    update: (ref: ListingRef, scope: Scope, actor: StoreActor) => Promise<void>
  },
  actor: StoreActor,
): Promise<ListingRef[]> {
  const { providers, index, runs, update } = deps
  await Promise.all(providers.map(async (provider) => provider.refresh?.().catch(() => {})))
  await runs.syncNow(actor)
  const queued: ListingRef[] = []
  for (const listing of await index.stated(actor.userId)) {
    const scopes = listing.installs.filter((install) => install.updateTo)
    if (scopes.length === 0 || listing.incompatible || runs.busy(listing)) continue
    try {
      for (const { scope } of scopes) await update(listing.ref, scope, actor)
      queued.push(listing.ref)
    } catch {
      // Its provider refused (a folder of the person's own by that name): the rest still go.
    }
  }
  return queued
}
