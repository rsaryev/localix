import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import { ConflictError } from '../../lib/domain-errors'
import { isRecord } from '../../lib/record'
import { pathExists } from '../ext/fs-discovery'
import type { InPlaceInstall } from './install-in-place'
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
import { entryVersionFacts, resolvePluginVersion, type VersionSourceFacts } from './plugin-version'

/**
 * A user-scope install from a marketplace that Localix copies goes into the version cache
 * (`plugin-cache.ts`), as Claude Code's does: `cache/<marketplace>/<plugin>/<version>/`, with its
 * record in `installed_plugins.json`. A project-scope install, a plugin loading in place from a
 * local-folder marketplace and a plugin installed from a path or a git URL keep their folder under
 * the scope's plugins root.
 */
export interface VersionedInstall {
  /** `<plugin>@<marketplace>`, the record's key. */
  id: string
  /** The marketplace entry's name: the cache folder and the plugin's place in the plugins root. */
  plugin: string
  version: string
  /** `cache/<marketplace>/<plugin>`, the folder the version is published into. */
  root: string
  /** `cache/<marketplace>/<plugin>/<version>`. */
  dir: string
  commitSha?: string
}

async function manifestField(dir: string, field: 'name' | 'version'): Promise<string | undefined> {
  try {
    const json = JSON.parse(await fs.readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
    return isRecord(json) && typeof json[field] === 'string' ? json[field] : undefined
  } catch {
    return undefined
  }
}
const manifestVersion = (dir: string) => manifestField(dir, 'version')
const manifestName = (dir: string) => manifestField(dir, 'name')

/** The version a resolved marketplace plugin installs at, computed as Claude Code computes it. */
export async function resolvedVersion(resolved: ResolvedMarketplaceInstall): Promise<string> {
  const facts = entryVersionFacts(resolved.entry)
  const source: VersionSourceFacts =
    facts.kind === 'relative' || facts.kind === 'git'
      ? { ...facts, ...(resolved.commitSha ? { commitSha: resolved.commitSha } : {}) }
      : facts
  return resolvePluginVersion({
    manifestVersion: await manifestVersion(resolved.dir),
    entryVersion: resolved.entry.version,
    source,
  })
}

export async function versionedInstallFor(input: {
  resolved: ResolvedMarketplaceInstall | null
  inPlace: InPlaceInstall | null
  scope: 'global' | 'project'
  home: string
}): Promise<VersionedInstall | null> {
  const { resolved } = input
  if (!resolved || input.inPlace || input.scope !== 'global') return null
  const plugin = resolved.entry.name
  const version = await resolvedVersion(resolved)
  return {
    id: `${plugin}@${resolved.marketplace}`,
    plugin,
    version,
    root: cachedPluginDir(input.home, resolved.marketplace, plugin),
    dir: cachedVersionDir(input.home, resolved.marketplace, plugin, version),
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
  const record = (await readInstallRecords(home))[versioned.id]
  if (!replace) {
    if (record)
      throw new ConflictError(
        'plugin_already_installed',
        `Plugin "${versioned.plugin}" is already installed (scope: user)`,
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
  const existing = (await readInstallRecords(home))[versioned.id]
  const previous = await setInstallRecord(home, versioned.id, {
    installPath: versioned.dir,
    version: versioned.version,
    installedAt: existing?.installedAt || at,
    lastUpdated: at,
    ...(versioned.commitSha ? { gitCommitSha: versioned.commitSha } : {}),
  })
  return {
    undo: async () => {
      await setInstallRecord(home, versioned.id, previous)
    },
    settle: async () => {
      await clearOrphaned(versioned.dir)
      if (previous && resolve(previous.installPath) !== resolve(versioned.dir))
        await markOrphaned(home, previous.installPath)
    },
  }
}

/** Release every cached copy that loads under `name` (its entry or its manifest says so). */
export async function releaseCachedCopiesOf(home: string, name: string): Promise<void> {
  for (const [id, record] of Object.entries(await readInstallRecords(home))) {
    const entryName = id.slice(0, id.lastIndexOf('@'))
    if (entryName === name || (await manifestName(record.installPath)) === name)
      await releaseCachedInstall(home, id, record.installPath)
  }
}

/** An uninstall of a cached copy: the record goes and the version is orphaned, not deleted. */
export async function releaseCachedInstall(home: string, id: string, dir: string): Promise<void> {
  await setInstallRecord(home, id, null)
  await markOrphaned(home, dir)
}
