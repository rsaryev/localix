import type { Kysely } from 'kysely'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { AppDatabase } from '../../db/types'
import { ApiError } from '../../lib/errors'
import { createAvailabilityWriter, readAvailability } from '../capabilities/availability'
import { pluginTrustClass } from './enable'
import type { CapabilitySourceRecord } from '../capabilities/source-repository'
import type { CapabilityStores } from '../capabilities/store-factory'
import { publishExtensionTrees } from '../ext/publish-trees'
import { createContributionStore } from '../ext/contribution-store'
import type { ContributionKindRegistry } from '../ext/contribution-kinds'
import type { PreparedDependencyInstall } from './dependencies-install'
import { loadManifest, type DiscoveredPlugin } from './discovery'
import type { MaterializedPluginSource } from './install-helpers'
import { normalizePluginDependencies } from './dependencies'
import { planDependencyEnables } from './dependencies-policy'

/** One file publication and one database commit for the parent and its dependency plan. */
export async function publishPluginInstallation(input: {
  db: Kysely<AppDatabase>
  stores: CapabilityStores
  contributionKinds: ContributionKindRegistry
  userId: string
  projectId: string
  scope: 'global' | 'project'
  installRoot: string
  parent: MaterializedPluginSource
  source: string
  replace: boolean
  enable?: boolean
  now: () => string
  dependencies: Pick<PreparedDependencyInstall, 'publication'> | null
  prepare: (directory: string) => Promise<void>
  discover: () => Promise<DiscoveredPlugin[]>
}): Promise<{ plugin: DiscoveredPlugin; state: CapabilitySourceRecord; warnings: string[] }> {
  const publication = input.dependencies?.publication(input)
  let result:
    | { plugin: DiscoveredPlugin; state: CapabilitySourceRecord; warnings: string[] }
    | undefined
  const commit = async (directory: string) => {
    const plugin = await loadManifest(directory, input.scope, input.projectId)
    if (plugin.error) throw new ApiError(400, 'plugin_invalid', plugin.error)
    // Files are published while their backups and locks are retained. Resolve the graph before
    // taking the database transaction so discovery never calls back into a held DB connection.
    const hasDependencies = normalizePluginDependencies(plugin.manifest.dependencies).length > 0
    const discovered = hasDependencies ? await input.discover() : []
    const warnings: string[] = []
    const state = await input.db.transaction().execute(async (transaction) => {
      const repo = input.stores.sources(transaction, 'plugin', input.now)
      const dependencySources = (await publication?.write(repo)) ?? []
      const saved = await repo.upsert(input.userId, input.projectId, plugin.manifest.name, {
        source: input.source,
      })
      const contributions = createContributionStore(transaction, input.contributionKinds, input.now)
      for (const entry of [
        ...dependencySources,
        { source: saved, contributions: plugin.manifest.contributions ?? [] },
      ]) {
        const current = await contributions.getCurrent(input.userId, entry.source.id)
        if (!current) throw new Error('Installed contribution source is missing')
        await contributions.publish(
          input.userId,
          entry.source.id,
          current.revision,
          entry.contributions,
        )
      }
      if (input.enable !== undefined)
        await createAvailabilityWriter(transaction).set(input.userId, DEFAULT_AGENT_ID, 'plugin', [
          { name: plugin.manifest.name, enabled: input.enable },
        ])
      const enabled =
        (
          await readAvailability(transaction, {
            userId: input.userId,
            agentId: DEFAULT_AGENT_ID,
          })
        ).effectFor('plugin', plugin.manifest.name, pluginTrustClass(plugin)) === 'allow'
      if (enabled && hasDependencies) {
        const cascade = await planDependencyEnables(transaction, {
          userId: input.userId,
          plugin,
          discovered,
        })
        await createAvailabilityWriter(transaction).apply(
          input.userId,
          DEFAULT_AGENT_ID,
          cascade.changes,
        )
        warnings.push(...cascade.result.warnings)
      }
      return saved
    })
    result = { plugin, state, warnings }
  }
  // A discovered drop-in is user-owned in place. Only dependency trees are published for it.
  if (input.parent.inPlace) await input.prepare(input.parent.directory)
  try {
    await publishExtensionTrees({
      installRoot: input.installRoot,
      trees: [
        ...(!input.parent.inPlace
          ? [
              {
                source: input.parent.directory,
                name: input.parent.name,
                replace: input.replace,
                prepare: input.prepare,
              },
            ]
          : []),
        ...(publication?.trees ?? []),
      ].map((tree) => ({
        ...tree,
        prepare: async (directory: string) => {
          await tree.prepare?.(directory)
          const prepared = await loadManifest(directory, input.scope, input.projectId)
          if (prepared.error) throw new ApiError(400, 'plugin_invalid', prepared.error)
          input.contributionKinds.normalize(prepared.manifest.contributions ?? [])
        },
      })),
      commit: (directories) =>
        commit(input.parent.inPlace ? input.parent.directory : directories[0]!),
    })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'extension_exists')
      throw new ApiError(
        409,
        'plugin_exists',
        'A plugin already exists at this destination. Remove it first.',
      )
    throw error
  }
  return result!
}
