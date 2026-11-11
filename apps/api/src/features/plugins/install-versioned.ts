import { join, resolve } from 'node:path'

import { ConflictError } from '../../lib/domain-errors'
import { pathExists } from '../ext/fs-discovery'
import { discoverCachedPlugins } from './cached-installs'
import type { InPlaceInstall } from './install-in-place'
import { pluginVersion, readFetchedManifest } from './kit'
import type { ResolvedMarketplaceInstall } from './marketplace-registry'
import {
  cachedPluginDir,
  cachedVersionDir,
  clearOrphaned,
  markOrphaned,
  readInstallRecords,
  setInstallRecord,
  type CachedInstallRecord,
} from './plugin-cache'
import { entryVersionInput, withCommit } from './plugin-version'

/**
 * A user-scope install from a marketplace that Localix copies goes into the version cache
 * (`plugin-cache.ts`), as Claude Code's does: `cache/<marketplace>/<plugin>/<version>/`, with its
 * record in `installed_plugins.json`. A project-scope one keeps its folder under the project's
 * plugins root, recorded there too (`scope: "project"`, its `projectPath`), so it loads with its
 * entry as well. A plugin loading in place from a local-folder marketplace and a plugin installed
 * from a path or a git URL keep their folder under the scope's plugins root, unrecorded.
 */
export interface VersionedInstall {
  /** `<plugin>@<marketplace>`, the record's key. */
  id: string
  /** The marketplace entry's name: the cache folder and the plugin's place in the plugins root. */
  plugin: string
  version: string
  /** The folder the copy is published into: `cache/<marketplace>/<plugin>`, or a project's plugins root. */
  root: string
  /** The copy: `cache/<marketplace>/<plugin>/<version>`, or `<project>/.localix/plugins/<plugin>`. */
  dir: string
  /** The project a project-scope copy is recorded for. */
  projectPath?: string
  commitSha?: string
}

/** The version a resolved marketplace plugin installs at, computed as Claude Code computes it. */
export async function resolvedVersion(
  resolved: Pick<ResolvedMarketplaceInstall, 'dir' | 'entry' | 'commitSha'>,
): Promise<string> {
  const declared = (await readFetchedManifest(resolved.dir))?.version
  const { version } = resolved.entry
  return pluginVersion({
    ...withCommit(entryVersionInput(resolved.entry), resolved.commitSha),
    ...(declared === undefined ? {} : { manifestVersion: declared }),
    ...(version === undefined ? {} : { entryVersion: version }),
  })
}

export async function versionedInstallFor(input: {
  resolved: Pick<ResolvedMarketplaceInstall, 'dir' | 'entry' | 'commitSha' | 'marketplace'> | null
  inPlace: InPlaceInstall | null
  /** The project folder of a project-scope install, else `null` (user scope). */
  projectPath: string | null
  /** The scope's plugins root, where a project-scope copy goes. */
  installRoot: string
  home: string
}): Promise<VersionedInstall | null> {
  const { resolved } = input
  if (!resolved || input.inPlace) return null
  const plugin = resolved.entry.name
  const version = await resolvedVersion(resolved)
  const at = input.projectPath
    ? {
        root: input.installRoot,
        dir: join(input.installRoot, plugin),
        projectPath: input.projectPath,
      }
    : {
        root: cachedPluginDir(input.home, resolved.marketplace, plugin),
        dir: cachedVersionDir(input.home, resolved.marketplace, plugin, version),
      }
  return {
    id: `${plugin}@${resolved.marketplace}`,
    plugin,
    version,
    ...at,
    ...(resolved.commitSha ? { commitSha: resolved.commitSha } : {}),
  }
}

/**
 * What an install of `versioned` finds already there: the record when the same version is installed
 * and on disk (an update then installs nothing, as in Claude Code), and a refusal when it is a fresh
 * install of a plugin that is installed (`plugin_already_installed`).
 */
export async function existingVersion(
  home: string,
  versioned: VersionedInstall,
  replace: boolean,
): Promise<CachedInstallRecord | null> {
  const record = (await readInstallRecords(home, versioned.projectPath))[versioned.id]
  if (!replace) {
    if (record)
      throw new ConflictError(
        'plugin_already_installed',
        `Plugin "${versioned.plugin}" is already installed (scope: ${versioned.projectPath ? 'project' : 'user'})`,
      )
    return null
  }
  if (record?.version === versioned.version && (await pathExists(record.installPath))) return record
  return null
}

/**
 * Inside the install's commit: record the new version. `undo` restores the record before it when
 * the database commit fails; `settle` then marks the version before orphaned (removed 14 days later)
 
 */
export async function claimCachedRecord(
  home: string,
  versioned: VersionedInstall,
  now: () => string,
): Promise<{ undo: () => Promise<void>; settle: () => Promise<void> }> {
  const at = now()
  const { projectPath } = versioned
  const existing = (await readInstallRecords(home, projectPath))[versioned.id]
  const previous = await setInstallRecord(
    home,
    versioned.id,
    {
      installPath: versioned.dir,
      version: versioned.version,
      installedAt: existing?.installedAt || at,
      lastUpdated: at,
      ...(versioned.commitSha ? { gitCommitSha: versioned.commitSha } : {}),
    },
    projectPath,
  )
  return {
    undo: async () => {
      await setInstallRecord(home, versioned.id, previous, projectPath)
    },
    settle: async () => {
      await clearOrphaned(versioned.dir)
      if (previous && resolve(previous.installPath) !== resolve(versioned.dir))
        await markOrphaned(home, previous.installPath)
    },
  }
}

/** Release every cached copy that loads under `name`, as it loads (with its entry). */
export async function releaseCachedCopiesOf(home: string, name: string): Promise<void> {
  for (const plugin of await discoverCachedPlugins({ homeDir: home, projectId: '' }))
    if (plugin.cachedInstall && plugin.manifest.name === name)
      await releaseCachedInstall(home, plugin.cachedInstall.id, plugin.dir)
}

/**
 * An uninstall of a recorded copy: the record goes. A cached version is orphaned, not deleted; a
 * project's copy (`projectPath`) is its folder, which the uninstall removes.
 */
export async function releaseCachedInstall(
  home: string,
  id: string,
  dir: string,
  projectPath?: string,
): Promise<void> {
  await setInstallRecord(home, id, null, projectPath)
  if (projectPath === undefined) await markOrphaned(home, dir)
}
