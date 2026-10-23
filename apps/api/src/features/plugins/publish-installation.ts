import { ConflictError, InvalidRequestError } from '../../lib/domain-errors'
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
import { actionFor } from '../capabilities/resolve'
import { claimInPlaceRecord, type InPlaceClaim } from './install-in-place'

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
  /** Reads the parent as it will load; a plugin loading in place is read with its entry. */
  loadParent?: (directory: string) => Promise<DiscoveredPlugin>
  /** A user-scope install's in-place record (`install-in-place.ts`), written with the commit. */
  inPlaceClaim?: InPlaceClaim
}): Promise<{ plugin: DiscoveredPlugin; state: CapabilitySourceRecord; warnings: string[] }> {
  const publication = input.dependencies?.publication(input)
  let result:
    | { plugin: DiscoveredPlugin; state: CapabilitySourceRecord; warnings: string[] }
    | undefined
  const commit = async (directory: string) => {
    const plugin = input.loadParent
      ? await input.loadParent(directory)
      : await loadManifest(directory, input.scope, input.projectId)
    if (plugin.error) throw new InvalidRequestError('plugin_invalid', plugin.error)
    // Files are published while their backups and locks are retained. Resolve the graph before
    // taking the database transaction so discovery never calls back into a held DB connection.
    const hasDependencies = normalizePluginDependencies(plugin.manifest.dependencies).length > 0
    const discovered = hasDependencies ? await input.discover() : []
    const warnings: string[] = []
    // The record, the row and its change notice are written here, under the destination lock.
    const claim = input.inPlaceClaim
      ? await claimInPlaceRecord(
          input.inPlaceClaim,
          plugin.manifest.name,
          input.parent.name,
          input.replace,
        )
      : null
    const write = input.db.transaction().execute(async (transaction) => {
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
      const enable = await installedSwitch(input, plugin, transaction)
      if (enable !== undefined)
        await createAvailabilityWriter(transaction).set(input.userId, DEFAULT_AGENT_ID, 'plugin', [
          { name: plugin.manifest.name, enabled: enable },
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
    const state = await write.catch(async (error: unknown) => {
      await claim?.undo()
      throw error
    })
    await claim?.settle()
    result = { plugin, state, warnings }
  }
  // A discovered drop-in is user-owned in place. Only dependency trees are published for it.
  if (input.parent.inPlace) await input.prepare(input.parent.directory)
  try {
    await publishExtensionTrees({
      installRoot: input.installRoot,
      // A plugin used where it is publishes no tree of its own, but still holds its name.
      ...(input.parent.inPlace ? { hold: [input.parent.name] } : {}),
      trees: [
        ...(!input.parent.inPlace
          ? [
              {
                source: input.parent.directory,
                name: input.parent.name,
                replace: input.replace,
                linkRoot: input.parent.linkRoot,
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
          if (prepared.error) throw new InvalidRequestError('plugin_invalid', prepared.error)
          input.contributionKinds.normalize(prepared.manifest.contributions ?? [])
        },
      })),
      commit: (directories) =>
        commit(input.parent.inPlace ? input.parent.directory : directories[0]!),
    })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'extension_exists') {
      // Claude Code: "Already installed at that scope: the output is `Plugin "…" is already
      // installed (scope: project)`". A folder there with no install record is something else.
      if (
        await input.stores
          .sources(input.db, 'plugin')
          .get(input.userId, input.projectId, input.parent.name)
      )
        throw new ConflictError(
          'plugin_already_installed',
          `Plugin "${input.parent.name}" is already installed (scope: ${input.scope === 'project' ? 'project' : 'user'})`,
        )
      throw new ConflictError(
        'plugin_exists',
        'A plugin already exists at this destination. Remove it first.',
      )
    }
    throw error
  }
  return result!
}

/**
 * The switch an install writes. `defaultEnabled: false` (the manifest's or the marketplace
 * entry's, already merged into the manifest) keeps a fresh install off, as Claude Code does,
 * "unless … you haven't enabled it yourself": a switch the person already set is left alone.
 * A dependency is not installed through here; the cascade below enables it regardless.
 */
async function installedSwitch(
  input: { stores: CapabilityStores; userId: string; enable?: boolean },
  plugin: DiscoveredPlugin,
  transaction: Kysely<AppDatabase>,
): Promise<boolean | undefined> {
  if (input.enable !== true || plugin.manifest.defaultEnabled !== false) return input.enable
  const action = actionFor('plugin', plugin.manifest.name)
  const rules = await input.stores.rules(transaction).read(input.userId, DEFAULT_AGENT_ID)
  return rules.some((rule) => rule.action === action && rule.resource === '*') ? undefined : false
}
