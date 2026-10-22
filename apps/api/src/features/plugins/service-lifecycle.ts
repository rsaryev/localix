/**
 * Lifecycle rules the plugin service applies around its writes, kept out of `service.ts`:
 * which row a plugin's state lives in, when an enable or disable is refused, when an uninstall
 * takes the plugin's data directory with it, and validating a folder that is not installed.
 */
import { promises as fs } from 'node:fs'

import { ConflictError } from '../../lib/domain-errors'
import type { AvailabilityReader } from '../capabilities/availability'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { pluginDataDir } from '../ext/user-config-substitute'
import type { PluginCatalog } from './catalog'
import { listDependents } from './dependencies'
import { loadManifest, type DiscoveredPlugin } from './discovery'
import {
  LOCALIX_MARKETPLACE,
  marketplacesRoot,
  parseMarketplaceRef,
  readKnownMarketplaces,
  updateMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
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
  home: string
  repo: CapabilitySourceRepository
  discoverHome: () => Promise<DiscoveredPlugin[]>
}): Promise<void> {
  if (!input.repo.scopesOf) return
  if ((await input.repo.scopesOf(input.userId, input.name)).length > 0) return
  if ((await input.discoverHome()).some((plugin) => plugin.manifest.name === input.name)) return
  await fs.rm(pluginDataDir(input.name, input.home), { recursive: true, force: true })
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
 * Before an update re-installs `<plugin>@<marketplace>` from a marketplace added from a local
 * folder (or a catalog file inside one), take a fresh copy of that folder. Claude Code loads such a plugin in place ("Your edits
 * … take effect at the next session start or /reload-plugins, and you don't need to increase the
 * version"); Localix installs from the copy it took when the marketplace was added, which an
 * update used to re-install unchanged. A folder that is gone keeps the copy there is.
 */
export async function refreshLocalMarketplace(
  source: string,
  deps: MarketplaceRegistryDeps,
): Promise<void> {
  const ref = parseMarketplaceRef(source)
  if (!ref || ref.marketplace === LOCALIX_MARKETPLACE) return
  const known = await readKnownMarketplaces(deps.root ?? marketplacesRoot())
  const kind = known[ref.marketplace]?.source.source
  if (kind !== 'local' && kind !== 'file') return
  await updateMarketplace(ref.marketplace, deps).catch(() => undefined)
}
