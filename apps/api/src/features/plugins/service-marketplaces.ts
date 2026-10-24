import { InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { installedFromMarketplace } from './marketplace-installed'
import {
  autoUpdatePassAllowed,
  isOfficialMarketplace,
  marketplaceAutoUpdate,
  OFFICIAL_MARKETPLACE,
  setMarketplaceAutoUpdate,
} from './marketplace-auto-update'
import { readMarketplace } from './marketplace-catalog'
import {
  addMarketplace,
  listMarketplaces,
  marketplacesRoot,
  parseMarketplaceInput,
  parseMarketplaceRef,
  readKnownMarketplaces,
  removeMarketplace,
  updateMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import {
  forgetOfficialMarketplaceRemoval,
  rememberOfficialMarketplaceRemoval,
} from './official-marketplace'
import type { PluginService } from './service-types'
import { resolveEntryName, type Marketplace } from './marketplace'

/** What became of an installed plugin's entry: still listed, renamed, or removed. */
function entryFate(
  market: Marketplace,
  name: string,
): { kind: 'listed' } | { kind: 'renamed'; to: string } | { kind: 'removed' } {
  try {
    const resolved = resolveEntryName(market, name)
    if (!market.plugins.some((entry) => entry.name === resolved.name)) return { kind: 'removed' }
    return resolved.renamedFrom ? { kind: 'renamed', to: resolved.name } : { kind: 'listed' }
  } catch {
    return { kind: 'removed' }
  }
}

/**
 * The plugin service's marketplace registry methods (`/plugin marketplace add|list|update|remove`).
 * As in Claude Code, a marketplace owns the plugins installed from it: updating it updates them,
 * removing it uninstalls them. A renamed plugin is migrated to its current name, and one the
 * catalog dropped is uninstalled only under `forceRemoveDeletedPlugins`. Ownership is read from the global install rows
 * (`<plugin>@<marketplace>`); a project-scoped install is left for its project.
 */
export function createMarketplaceMethods(deps: {
  registryDeps: MarketplaceRegistryDeps
  /** Register what the user's and managed settings declare (`declared-marketplaces.ts`). */
  syncDeclared?: (cwd: string | null) => Promise<void>
  repo: CapabilitySourceRepository
  update: (userId: string, name: string) => Promise<unknown>
  remove: (userId: string, name: string) => Promise<unknown>
  /** Listings changed: compute the available updates again (`plugin-updates.ts`). */
  recheck: (userId: string) => Promise<unknown>
  env: Record<string, string | undefined>
  /** Install `to` from the marketplace in place of the renamed `from`. */
  migrate?: (userId: string, from: string, to: string) => Promise<unknown>
}): Pick<
  PluginService,
  | 'addMarketplace'
  | 'listMarketplaces'
  | 'updateMarketplace'
  | 'refreshMarketplaces'
  | 'setMarketplaceAutoUpdate'
  | 'removeMarketplace'
> {
  const { registryDeps, repo } = deps
  const root = registryDeps.root ?? marketplacesRoot()
  const owned = async (userId: string, name: string) =>
    installedFromMarketplace(
      await repo.listForScope(userId, ''),
      name,
      (await readKnownMarketplaces(root))[name],
    )
  /** The entries an update leaves for the person: Claude Code skips a `headersHelper` entry. */
  const manualEntries = async (name: string): Promise<Set<string>> => {
    const dir = (await readKnownMarketplaces(root))[name]?.installLocation
    const market = dir ? await readMarketplace(dir).catch(() => null) : null
    return new Set(
      (market?.plugins ?? [])
        .filter((entry) => (entry as Record<string, unknown>).headersHelper !== undefined)
        .map((entry) => entry.name),
    )
  }

  return {
    async addMarketplace(_userId, input) {
      const parsed = parseMarketplaceInput(input.source)
      if ('error' in parsed) throw new InvalidRequestError('marketplace_bad_source', parsed.error)
      try {
        const added = await addMarketplace(parsed, registryDeps)
        // Added by the person: the start-up registration may keep it again from now on.
        if (added.name === OFFICIAL_MARKETPLACE.name) await forgetOfficialMarketplaceRemoval(root)
        return added
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
      await deps.syncDeclared?.(null).catch(() => undefined)
      const [rows, known] = await Promise.all([
        listMarketplaces(registryDeps),
        readKnownMarketplaces(root),
      ])
      const paused = !autoUpdatePassAllowed(deps.env)
      return rows.map((row) => {
        const record = known[row.name]
        if (!record) return row
        return {
          ...row,
          autoUpdate: marketplaceAutoUpdate(row.name, record),
          ...(paused ? { autoUpdatePaused: true } : {}),
          ...(isOfficialMarketplace(row.name, record) ? { official: true } : {}),
          ...(record.lastUpdated ? { lastUpdated: record.lastUpdated } : {}),
        }
      })
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
      const manualNames = await manualEntries(refreshed.name)
      const updated: string[] = []
      const manual: string[] = []
      const warnings: string[] = []
      const root = registryDeps.root ?? marketplacesRoot()
      const known = (await readKnownMarketplaces(root))[refreshed.name]
      const market = known ? await readMarketplace(known.installLocation).catch(() => null) : null
      for (const row of await owned(userId, refreshed.name)) {
        if (manualNames.has(parseMarketplaceRef(row.source)?.plugin ?? row.name)) {
          manual.push(row.name)
          continue
        }
        try {
          const fate = market ? entryFate(market, row.name) : { kind: 'listed' as const }
          if (fate.kind === 'renamed' && deps.migrate) {
            await deps.migrate(userId, row.name, fate.to)
            updated.push(fate.to)
          } else if (fate.kind === 'removed') {
            // A plugin the catalog dropped stays installed unless it asks for the removal.
            if (!market?.forceRemoveDeletedPlugins) {
              warnings.push(
                `${row.name}: Plugin "${row.name}" not found in marketplace "${refreshed.name}"`,
              )
              continue
            }
            await deps.remove(userId, row.name)
          } else {
            await deps.update(userId, row.name)
            updated.push(row.name)
          }
        } catch (err) {
          warnings.push(`${row.name}: ${errorMessage(err)}`)
        }
      }
      await deps.recheck(userId).catch(() => {})
      return { ...refreshed, updated, manual, warnings }
    },

    async refreshMarketplaces(userId) {
      const refreshed: string[] = []
      const warnings: string[] = []
      for (const name of Object.keys(await readKnownMarketplaces(root))) {
        try {
          await updateMarketplace(name, registryDeps)
          refreshed.push(name)
        } catch (err) {
          warnings.push(`${name}: ${errorMessage(err)}`)
        }
      }
      await deps.recheck(userId).catch(() => {})
      return { refreshed, updated: [], manual: [], warnings }
    },

    async setMarketplaceAutoUpdate(_userId, input) {
      await setMarketplaceAutoUpdate(root, input.name, input.autoUpdate)
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
      // Removed by the person: the start-up registration does not add it back.
      if (input.name === OFFICIAL_MARKETPLACE.name) await rememberOfficialMarketplaceRemoval(root)
      for (const row of plugins) await deps.remove(userId, row.name)
      return { uninstalled: plugins.map((row) => row.name) }
    },
  }
}
