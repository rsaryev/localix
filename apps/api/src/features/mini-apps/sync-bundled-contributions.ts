import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { createContributionStore } from '../ext/contribution-store'
import type { ContributionKindRegistry } from '../ext/contribution-kinds'
import type { CapabilityStores } from '../capabilities/store-factory'
import { seedBundledAgentContribution } from '../agents/seed-bundled-contribution'
import type { DiscoveredMiniApp } from './discovery'

/** Reconcile only managed first-party manifests. A user-installed lookalike receives no grant. */
export async function syncBundledContributions(input: {
  db: Kysely<AppDatabase>
  stores: CapabilityStores
  kinds: ContributionKindRegistry
  userId: string
  projectId: string
  apps: readonly DiscoveredMiniApp[]
  now: () => string
}) {
  const managed = input.apps.filter((miniApp) => miniApp.bundled)
  const bundled = managed.filter((miniApp) => {
    if (miniApp.error) return false
    try {
      input.kinds.normalize(miniApp.contributions)
      return true
    } catch {
      console.warn(
        `[mini-apps] Invalid bundled contributions in ${miniApp.name}; retaining the last valid publication.`,
      )
      return false
    }
  })
  await input.db.transaction().execute(async (db) => {
    const sources = input.stores.sources(db, 'mini-app', input.now)
    const store = createContributionStore(db, input.kinds, input.now)
    const visible = new Set(managed.map((miniApp) => miniApp.name))
    for (const source of await sources.listForScope(input.userId, input.projectId)) {
      if (
        source.projectId !== input.projectId ||
        source.source !== 'bundled' ||
        visible.has(source.name)
      )
        continue
      const current = await store.getCurrent(input.userId, source.id)
      if (current?.contributions.length)
        await store.publish(input.userId, source.id, current.revision, [])
    }
    for (const miniApp of bundled) {
      // Keep existing sources with no contributions, so a removed declaration gets archived.
      const existing = await sources.get(input.userId, input.projectId, miniApp.name)
      const declarations = miniApp.contributions
      if (!existing && declarations.length === 0) continue
      const source =
        existing ??
        (await sources.upsert(input.userId, input.projectId, miniApp.name, {
          source: 'bundled',
        }))
      const current = await store.getCurrent(input.userId, source.id)
      const published = await store.publish(
        input.userId,
        source.id,
        current!.revision,
        declarations,
      )
      for (const entry of published.contributions)
        await seedBundledAgentContribution(db, input.stores, input.userId, entry)
    }
  })
}
