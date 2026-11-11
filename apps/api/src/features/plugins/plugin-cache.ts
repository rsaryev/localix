import { dirname, join, resolve } from 'node:path'

import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { rmrf } from '../ext/install-tree'
import {
  clearOrphaned,
  markOrphaned as markVersion,
  orphansToSweep,
  pluginStore,
  readInstalled,
  versionsToOrphan,
  writeInstalled,
  type InstallRecord,
} from './kit'

/**
 * THE VERSIONED PLUGIN CACHE, laid out as Claude Code lays out `~/.claude/plugins` (loading.md,
 * "Find plugins on disk"), under Localix's plugins root `~/.localix/plugins`:
 *
 *   cache/<marketplace>/<plugin>/<version>/   one folder per installed version
 *   installed_plugins.json                     `{ version: 2, plugins: { "<plugin>@<marketplace>":
 *                                               [{ scope, installPath, version, … }] } }`
 *
 * The kit lays it out and reads and writes the file (`kit/marketplace/installs.ts`); Localix
 * records its user-scope copies there and keeps every other record as it is. A copy is read through
 * its record (`cached-installs.ts`). An update installs the new version beside the old one and marks
 * the old one with `.orphaned_at`, so whatever already started from it keeps its files; a
 * background sweep removes it 14 days later, only while at least one install is recorded.
 */

export interface CachedInstallRecord {
  installPath: string
  version: string
  installedAt: string
  lastUpdated: string
  /** The commit the copy was taken from, when its source was git. */
  gitCommitSha?: string
}

const serialize = createKeyedSerializer()

export const pluginsRoot = (home: string): string => join(home, '.localix', 'plugins')

export const cachedVersionDir = (
  home: string,
  marketplace: string,
  plugin: string,
  version: string,
): string => pluginStore(pluginsRoot(home)).versionDir(marketplace, plugin, version)

/** The folder of one plugin's versions, `cache/<marketplace>/<plugin>`. */
export const cachedPluginDir = (home: string, marketplace: string, plugin: string): string =>
  dirname(cachedVersionDir(home, marketplace, plugin, '_'))

const toCached = ({
  installPath,
  version,
  installedAt,
  lastUpdated,
  gitCommitSha,
}: InstallRecord) => ({
  installPath,
  version,
  installedAt: installedAt ?? '',
  lastUpdated: lastUpdated ?? '',
  ...(gitCommitSha ? { gitCommitSha } : {}),
})

/** The user-scope install records, by `<plugin>@<marketplace>`. */
export async function readInstallRecords(
  home: string,
): Promise<Record<string, CachedInstallRecord>> {
  const { records } = await readInstalled(pluginsRoot(home))
  return Object.fromEntries(
    Object.entries(records).flatMap(([id, installs]) => {
      const user = installs.find((one) => one.scope === 'user')
      return user ? [[id, toCached(user)]] : []
    }),
  )
}

/**
 * Set (or with `null`, drop) one user-scope record, serialized; returns the previous one. Every
 * other record, and what the kit keeps of fields it does not know, is written back as it was.
 */
export function setInstallRecord(
  home: string,
  id: string,
  record: CachedInstallRecord | null,
): Promise<CachedInstallRecord | null> {
  const root = pluginsRoot(home)
  return serialize(root, async () => {
    const { records } = await readInstalled(root)
    const installs = records[id] ?? []
    const previous = installs.find((one) => one.scope === 'user')
    if (!previous && !record) return null
    const kept = installs.filter((one) => one !== previous)
    const next = record ? [...kept, { ...previous, scope: 'user' as const, ...record }] : kept
    const { [id]: _, ...rest } = records
    await writeInstalled(root, next.length ? { ...rest, [id]: next } : rest)
    return previous ? toCached(previous) : null
  })
}

/** Mark a version folder the record before left behind, when no record still uses it. */
export async function markOrphaned(home: string, dir: string, now: () => number = Date.now) {
  const root = pluginsRoot(home)
  const { records } = await readInstalled(root)
  const left = versionsToOrphan(root, [{ scope: 'user', installPath: dir, version: '' }], records)
  for (const version of left) await markVersion(version, now())
}

export { clearOrphaned }

/** Remove the orphaned versions the kit's sweep names; returns what it removed. */
export async function sweepOrphanedVersions(
  home: string,
  opts: { now?: () => number } = {},
): Promise<string[]> {
  const removed = [...(await orphansToSweep(pluginsRoot(home), (opts.now ?? Date.now)()))]
  for (const dir of removed) await rmrf(resolve(dir))
  return removed
}
