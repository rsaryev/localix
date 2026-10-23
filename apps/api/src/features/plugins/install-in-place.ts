import { join, resolve } from 'node:path'

import { ConflictError } from '../../lib/domain-errors'
import { isPathWithin } from '../../lib/path-containment'
import { pathExists } from '../ext/fs-discovery'
import { removeIfUnderRoot } from '../ext/install-tree'
import type { DiscoveredPlugin } from './discovery-types'
import { loadInPlacePlugin, setInPlaceRecord, type InPlaceRecord } from './in-place-installs'
import { readManifestFiles } from './layout/read'
import type { MarketplaceEntry } from './marketplace'
import { entryPrunesSkills } from './marketplace-entry-manifest'
import type { ResolvedMarketplaceInstall } from './marketplace-registry'

/**
 * Installing a plugin IN PLACE (`in-place-installs.ts` holds the records and discovery).
 *
 * A user-scope install of a relative-path entry from a marketplace added from a local folder loads
 * from that folder, as in Claude Code, when the plugin is in Claude Code's format: no mini app
 * (`.localix-app/app.json`), no root `plugin.json`, no native tools, and an entry that does not
 * trim the plugin's skills (which only a copy can). Everything else, and every project-scope
 * install, is copied as before.
 */
export interface InPlaceInstall {
  record: InPlaceRecord
  entry: MarketplaceEntry
  /** The plugin as discovery will read it, for the scope's project id. */
  load: (projectId: string) => Promise<DiscoveredPlugin>
}

export async function inPlaceInstallFor(
  resolved: ResolvedMarketplaceInstall | null,
  scope: 'global' | 'project',
  installRoot: string,
): Promise<InPlaceInstall | null> {
  if (!resolved?.inPlace || scope !== 'global') return null
  const dir = resolve(resolved.dir)
  if (isPathWithin(resolve(installRoot), dir) || entryPrunesSkills(resolved.entry)) return null
  const files = await readManifestFiles(dir)
  if (files.miniApp) return null
  const record = { id: `${resolved.entry.name}@${resolved.marketplace}`, dir }
  const load = (projectId: string) => loadInPlacePlugin(record, resolved.entry, projectId)
  return { record, entry: resolved.entry, load }
}

/** What a user-scope install records for its name: this in-place record, or none (a copy). */
export interface InPlaceClaim {
  installRoot: string
  record: InPlaceRecord | null
}

/** The publication options of an install (`publishPluginInstallation`). */
export function inPlacePublication(
  inPlace: InPlaceInstall | null,
  scope: 'global' | 'project',
  installRoot: string,
  projectId: string,
): { inPlaceClaim?: InPlaceClaim; loadParent?: (directory: string) => Promise<DiscoveredPlugin> } {
  if (scope !== 'global') return {}
  if (!inPlace) return { inPlaceClaim: { installRoot, record: null } }
  return {
    inPlaceClaim: { installRoot, record: inPlace.record },
    loadParent: () => inPlace.load(projectId),
  }
}

/**
 * Inside an install's commit, under its destination lock: write the name's record (or drop one a
 * copy takes over). Without `replace`, an existing install of the name is refused. `undo` restores
 * the previous record when the database commit fails; `settle` then retires the copy an earlier
 * install left at `<installRoot>/<name>`, which would otherwise shadow the folder. Only a directory
 * strictly inside the install root is ever deleted.
 */
export async function claimInPlaceRecord(
  claim: InPlaceClaim,
  name: string,
  destinationName: string,
  replace: boolean,
): Promise<{ undo: () => Promise<void>; settle: () => Promise<void> }> {
  const copy = join(claim.installRoot, destinationName)
  const record = claim.record
  if (record && !replace && (await pathExists(copy)))
    throw new ConflictError('extension_exists', 'An extension already exists at this destination')
  const previous = await setInPlaceRecord(claim.installRoot, name, record, { replace })
  return {
    undo: async () => {
      await setInPlaceRecord(claim.installRoot, name, previous)
    },
    settle: async () => {
      if (record && resolve(copy) !== resolve(record.dir))
        await removeIfUnderRoot(copy, claim.installRoot)
    },
  }
}
