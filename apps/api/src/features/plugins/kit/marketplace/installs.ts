import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  ORPHANED_MARKER,
  createStoreLayout,
  dirsToOrphan,
  loadInstalledPlugins,
  orphanSweep,
  serializeInstalledPlugins,
  type InstallRecord,
  type InstalledRecords,
  type StoreLayout,
} from '@rsaryev/llx-plugin/marketplace'
import { systemClock } from '../ports/host-io'
import { diskPluginStateStore, nodeSha256 } from '../ports/marketplace-io'

/**
 * The installs under a plugins root, kept as Claude Code keeps them: `installed_plugins.json`
 * read, recovered and written by the kit (`loadInstalledPlugins`, `serializeInstalledPlugins`), the
 * version cache laid out by `createStoreLayout`, and the version folders an update or uninstall
 * leaves behind marked and swept as the kit says (`dirsToOrphan`, `orphanSweep`).
 */

export const pluginStore = (root: string): StoreLayout => createStoreLayout(root, join)

/**
 * The records the file holds, after the kit's recovery (an unreadable file is kept aside and
 * started over). `writable` is false while a record or the format is one this version cannot read.
 */
export async function readInstalled(
  root: string,
): Promise<{ records: InstalledRecords; writable: boolean; problem?: string }> {
  const ports = { store: diskPluginStateStore(() => root), sha256: nodeSha256, clock: systemClock }
  const { read } = await loadInstalledPlugins(ports, { signal: new AbortController().signal })
  const problem = read.issues[0]?.message
  return { records: read.records, writable: read.writable, ...(problem ? { problem } : {}) }
}

/** Write the records, refusing while the file holds what this version cannot read. */
export async function writeInstalled(root: string, records: InstalledRecords): Promise<void> {
  const current = await readInstalled(root)
  if (!current.writable)
    throw new Error(current.problem ?? 'installed_plugins.json is not writable')
  const failure = await diskPluginStateStore(() => root).write(
    pluginStore('').installedPlugins(),
    serializeInstalledPlugins(records),
    new AbortController().signal,
  )
  if (failure) throw new Error(failure.message)
}

/** The version folders `removed` leaves behind that no remaining record uses: mark each one. */
export const versionsToOrphan = (
  root: string,
  removed: readonly InstallRecord[],
  remaining: InstalledRecords,
): readonly string[] => dirsToOrphan(removed, Object.values(remaining).flat(), pluginStore(root))

export async function markOrphaned(dir: string, nowMs: number): Promise<void> {
  if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) return
  await fs.writeFile(join(dir, ORPHANED_MARKER), `${new Date(nowMs).toISOString()}\n`)
}

/** A version installed again is no longer orphaned. */
export const clearOrphaned = (dir: string): Promise<void> =>
  fs.rm(join(dir, ORPHANED_MARKER), { force: true })

async function subdirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name))
}

async function markedOrphans(layout: StoreLayout) {
  const orphans: { dir: string; orphanedAtMs: number }[] = []
  for (const market of await subdirs(layout.cache()))
    for (const plugin of await subdirs(market))
      for (const dir of await subdirs(plugin)) {
        const marked = await fs.readFile(join(dir, ORPHANED_MARKER), 'utf8').catch(() => null)
        const orphanedAtMs = marked ? Date.parse(marked.trim()) : Number.NaN
        if (!Number.isNaN(orphanedAtMs)) orphans.push({ dir, orphanedAtMs })
      }
  return orphans
}

/**
 * The orphaned version folders the background cleanup removes now: marked at least
 * `ORPHAN_GRACE_MS` (14 days) ago, used by no record, and only while some install is recorded.
 */
export async function orphansToSweep(root: string, nowMs: number): Promise<readonly string[]> {
  const layout = pluginStore(root)
  const remaining = Object.values((await readInstalled(root)).records).flat()
  if (remaining.length === 0) return []
  return orphanSweep({ remaining, orphans: await markedOrphans(layout), nowMs, layout })
}
