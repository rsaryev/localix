/**
 * Lifecycle rules the plugin service applies around its writes, kept out of `service.ts`:
 * which row a plugin's state lives in, when an enable or disable is refused, when an uninstall
 * takes the plugin's data directory with it, and validating a folder that is not installed.
 */
import { refreshMarketplaceBeforeUpdate } from './marketplace-refresh'
import { promises as fs } from 'node:fs'

import { ConflictError, InvalidRequestError } from '../../lib/domain-errors'
import type { AvailabilityReader } from '../capabilities/availability'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { pluginDataDir } from '../ext/user-config-substitute'
import type { PluginCatalog } from './catalog'
import { listDependents } from './dependencies'
import { loadManifest, type DiscoveredPlugin } from './discovery'
import type { MarketplaceRegistryDeps } from './marketplace-registry'
import { pluginTrustClass } from './enable'
import { validatePluginFull } from './validate'
import type { PluginValidation } from './contracts'

/**
 * The scope of the row a plugin's state lives in. A user-scope plugin is projected into every
 * project with that project's id, but it has ONE row, the no-project one: Claude Code keeps one
 * `pluginConfigs` entry per user, never per project.
 */
export function rowScopeOf(
  plugin: Pick<DiscoveredPlugin, 'scope'> | null | undefined,
  projectId: string,
): string {
  return plugin && plugin.scope !== 'project' ? '' : projectId
}

/**
 * Refuse a switch Claude Code refuses: disabling a plugin another enabled plugin depends on
 * (`plugin disable`: "the command fails and names the dependents to disable first"), and, when
 * the caller asks for it, a switch that changes nothing (`Plugin "x" is already enabled`).
 */
export function assertEnableChanges(input: {
  plugin: DiscoveredPlugin
  enabled: boolean
  availability: AvailabilityReader
  catalog: PluginCatalog | null
  refuseNoop: boolean
}): void {
  const name = input.plugin.manifest.name
  if (input.refuseNoop) {
    const effect = input.availability.effectFor('plugin', name, pluginTrustClass(input.plugin))
    // Awaiting consent is neither: disabling it is a decision, so it goes through.
    if (effect === (input.enabled ? 'allow' : 'deny'))
      throw new ConflictError(
        'plugin_already_in_state',
        `Plugin "${name}" is already ${input.enabled ? 'enabled' : 'disabled'}`,
      )
  }
  if (input.enabled || !input.catalog) return
  const dependents = listDependents(
    name,
    input.catalog.enabled.map((entry) => entry.plugin),
  )
  if (dependents.length === 0) return
  const list = dependents.join(', ')
  throw new ConflictError(
    'plugin_has_dependents',
    `Plugin "${name}" is needed by ${list}, which ${dependents.length === 1 ? 'is' : 'are'} enabled. Disable ${list} first, then ${name}.`,
  )
}

/**
 * Delete `${CLAUDE_PLUGIN_DATA}` when the plugin was removed from the last place it was
 * installed. The directory is keyed by name alone, so a copy left in any scope (a row anywhere,
 * or a user-scope folder) keeps it. A repository that cannot say where rows live keeps it too.
 */
export async function removeDataIfLastCopy(input: {
  userId: string
  name: string
  /** The plugin's identifier (`plugin-data-id.ts`), when known: its data folder's key. */
  id?: string
  home: string
  repo: CapabilitySourceRepository
  discoverHome: () => Promise<DiscoveredPlugin[]>
}): Promise<void> {
  if (!input.repo.scopesOf) return
  if ((await input.repo.scopesOf(input.userId, input.name)).length > 0) return
  if ((await input.discoverHome()).some((plugin) => plugin.manifest.name === input.name)) return
  await fs.rm(pluginDataDir(input.id ?? input.name, input.home), { recursive: true, force: true })
}

/** Validate a plugin folder in place (`claude plugin validate <path>`), installed or not. */
export async function validatePluginDir(
  dir: string,
  opts?: { strict?: boolean },
): Promise<{ name: string; validation: PluginValidation }> {
  const plugin = await loadManifest(dir, 'global', '')
  return {
    name: plugin.manifest.name,
    validation: await validatePluginFull(plugin, { strict: opts?.strict }),
  }
}

/**
 * `plugin update`: re-install from the source the plugin was installed from, at the scope of its
 * own row, so a user-scope plugin updated from a project chat stays a user-scope plugin ("updates
 * the plugin at the most specific scope it's installed at"). With `registryDeps`, a plugin from a
 * local-folder marketplace has that folder read again first; one loading in place is validated
 * again and keeps loading from the folder. Installation owns staging and
 * rollback; leaving `enable` out keeps the plugin's existing rules.
 */
export async function reinstallFromSource<R>(input: {
  repo: CapabilitySourceRepository
  userId: string
  name: string
  projectId: string
  plugin: DiscoveredPlugin | null
  registryDeps: MarketplaceRegistryDeps | null
  install: (source: string, projectId: string | null) => Promise<R>
}): Promise<R> {
  const { repo, userId, name, projectId, plugin } = input
  const state =
    (plugin ? await repo.get(userId, rowScopeOf(plugin, projectId), name) : null) ??
    (await repo.listForScope(userId, projectId)).find((s) => s.name === name)
  if (!state?.source || state.source === 'local') {
    throw new InvalidRequestError(
      'plugin_no_source',
      `Plugin "${name}" has no recorded install source — drop in the updated folder manually.`,
    )
  }
  // The marketplace is read again first (git, url and npm ones too), so the update sees new commits.
  if (input.registryDeps) await refreshMarketplaceBeforeUpdate(state.source, input.registryDeps)
  // The install leaves a copy whose computed version did not change alone (`upToDate`).
  return input.install(state.source, state.projectId || null)
}
