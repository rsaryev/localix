import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { createContributionStore } from '../ext/contribution-store'
import type { ContributionKindRegistry } from '../ext/contribution-kinds'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { seedBundledAgentContribution } from '../agents/seed-bundled-contribution'
import type { DiscoveredPlugin } from './discovery'

/** Reconcile only managed first-party manifests. A user-installed lookalike receives no grant. */
export async function syncBundledContributions(input: {
  db: Kysely<AppDatabase>
  kinds: ContributionKindRegistry
  userId: string
  projectId: string
  plugins: readonly DiscoveredPlugin[]
  now: () => string
}) {
  const managed = input.plugins.filter((plugin) => plugin.bundled)
  const bundled = managed.filter((plugin) => {
    if (plugin.error) return false
    try {
      input.kinds.normalize(plugin.manifest.contributions ?? [])
      return true
    } catch {
      console.warn(
        `[plugins] Invalid bundled contributions in ${plugin.manifest.name}; retaining the last valid publication.`,
      )
      return false
    }
  })
  await input.db.transaction().execute(async (db) => {
    const sources = createCapabilitySourceRepository(db, 'plugin', input.now)
    const store = createContributionStore(db, input.kinds, input.now)
    const visible = new Set(managed.map((plugin) => plugin.manifest.name))
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
    for (const plugin of bundled) {
      // Keep existing sources with no contributions, so a removed declaration gets archived.
      const existing = await sources.get(input.userId, input.projectId, plugin.manifest.name)
      const declarations = plugin.manifest.contributions ?? []
      if (!existing && declarations.length === 0) continue
      const source =
        existing ??
        (await sources.upsert(input.userId, input.projectId, plugin.manifest.name, {
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
        await seedBundledAgentContribution(db, input.userId, entry)
    }
  })
}
