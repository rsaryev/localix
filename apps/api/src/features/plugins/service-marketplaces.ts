import { InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { installedFromMarketplace } from './marketplace-installed'
import {
  addMarketplace,
  listMarketplaces,
  marketplacesRoot,
  parseMarketplaceInput,
  readKnownMarketplaces,
  removeMarketplace,
  updateMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import type { PluginService } from './service-types'

/**
 * The plugin service's marketplace registry methods (`/plugin marketplace add|list|update|remove`).
 * As in Claude Code, a marketplace owns the plugins installed from it: updating it updates them,
 * removing it uninstalls them. Ownership is read from the global install rows
 * (`<plugin>@<marketplace>`); a project-scoped install is left for its project.
 */
export function createMarketplaceMethods(deps: {
  registryDeps: MarketplaceRegistryDeps
  repo: CapabilitySourceRepository
  update: (userId: string, name: string) => Promise<unknown>
  remove: (userId: string, name: string) => Promise<unknown>
}): Pick<
  PluginService,
  'addMarketplace' | 'listMarketplaces' | 'updateMarketplace' | 'removeMarketplace'
> {
  const { registryDeps, repo } = deps
  const owned = async (userId: string, name: string) =>
    installedFromMarketplace(
      await repo.listForScope(userId, ''),
      name,
      (await readKnownMarketplaces(registryDeps.root ?? marketplacesRoot()))[name],
    )

  return {
    async addMarketplace(_userId, input) {
      const parsed = parseMarketplaceInput(input.source)
      if ('error' in parsed) throw new InvalidRequestError('marketplace_bad_source', parsed.error)
      try {
        return await addMarketplace(parsed, registryDeps)
      } catch (err) {
        // The raw text is an npm/git/HTTP failure, which on its own names no action at all —
        // "fetch failed" told the user nothing about what they had just clicked.
        throw new InvalidRequestError(
          'marketplace_add_failed',
          `That marketplace could not be added (${errorMessage(err)})`,
        )
      }
    },

    async listMarketplaces(_userId) {
      return listMarketplaces(registryDeps)
    },

    async updateMarketplace(userId, input) {
      let refreshed: { name: string; count: number }
      try {
        refreshed = await updateMarketplace(input.name, registryDeps)
      } catch (err) {
        throw new InvalidRequestError(
          'marketplace_update_failed',
          `"${input.name}" could not be updated (${errorMessage(err)})`,
        )
      }
      const updated: string[] = []
      const warnings: string[] = []
      for (const row of await owned(userId, refreshed.name)) {
        try {
          await deps.update(userId, row.name)
          updated.push(row.name)
        } catch (err) {
          warnings.push(`${row.name}: ${errorMessage(err)}`)
        }
      }
      return { ...refreshed, updated, warnings }
    },

    async removeMarketplace(userId, input) {
      const plugins = await owned(userId, input.name)
      try {
        await removeMarketplace(input.name, registryDeps)
      } catch (err) {
        throw new InvalidRequestError(
          'marketplace_remove_failed',
          `"${input.name}" could not be removed (${errorMessage(err)})`,
        )
      }
      for (const row of plugins) await deps.remove(userId, row.name)
      return { uninstalled: plugins.map((row) => row.name) }
    },
  }
}
