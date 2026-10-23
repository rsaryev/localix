import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { isPathBelow } from '../../lib/path-containment'
import { isRecord } from '../../lib/record'
import { rmrf } from '../ext/install-tree'

/**
 * THE VERSIONED PLUGIN CACHE, laid out as Claude Code lays out `~/.claude/plugins` (loading.md,
 * "Find plugins on disk"), under Localix's plugins root `~/.localix/plugins`:
 *
 *   cache/<marketplace>/<plugin>/<version>/   one folder per installed version
 *   installed_plugins.json                     `{ version: 2, plugins: { "<plugin>@<marketplace>":
 *                                               [{ scope, installPath, version, … }] } }`
 *
 * A user-scope copy installed from a marketplace lives here; discovery reads it through its record
 * (`cached-installs.ts`). An update installs the new version beside the old one and marks the old
 * one with `.orphaned_at`, so whatever already started from it keeps its files; a background sweep
 * removes it 14 days later. The sweep runs only while at least one install is recorded.
 */

export interface CachedInstallRecord {
  installPath: string
  version: string
  installedAt: string
  lastUpdated: string
  /** The commit the copy was taken from, when its source was git. */
  gitCommitSha?: string
}

const RECORDS_FILE = 'installed_plugins.json'
const ORPHAN_MARKER = '.orphaned_at'
/** "It removes that directory in a background cleanup 14 days later." */
export const ORPHAN_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

const serialize = createKeyedSerializer()

export const pluginsRoot = (home: string): string => join(home, '.localix', 'plugins')
export const pluginCacheRoot = (home: string): string => join(pluginsRoot(home), 'cache')
const recordsFile = (home: string) => join(pluginsRoot(home), RECORDS_FILE)

/** The folder of one plugin's versions, `cache/<marketplace>/<plugin>`. */
export const cachedPluginDir = (home: string, marketplace: string, plugin: string): string =>
  join(pluginCacheRoot(home), marketplace, plugin)

export const cachedVersionDir = (
  home: string,
  marketplace: string,
  plugin: string,
  version: string,
): string => join(cachedPluginDir(home, marketplace, plugin), version)

function toRecord(value: unknown): CachedInstallRecord | null {
  if (!isRecord(value)) return null
  if (typeof value.installPath !== 'string' || typeof value.version !== 'string') return null
  if (value.scope !== undefined && value.scope !== 'user') return null
  return {
    installPath: value.installPath,
    version: value.version,
    installedAt: typeof value.installedAt === 'string' ? value.installedAt : '',
    lastUpdated: typeof value.lastUpdated === 'string' ? value.lastUpdated : '',
    ...(typeof value.gitCommitSha === 'string' ? { gitCommitSha: value.gitCommitSha } : {}),
  }
}

/** The user-scope install records, by `<plugin>@<marketplace>`. */
export async function readInstallRecords(
  home: string,
): Promise<Record<string, CachedInstallRecord>> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(recordsFile(home), 'utf8'))
  } catch {
    return {}
  }
  const out: Record<string, CachedInstallRecord> = {}
  if (!isRecord(raw) || !isRecord(raw.plugins)) return out
  for (const [id, value] of Object.entries(raw.plugins)) {
    const record = (Array.isArray(value) ? value : [value]).map(toRecord).find(Boolean)
    if (record) out[id] = record
  }
  return out
}

/** Set (or with `null`, drop) one record, serialized and written atomically; returns the previous. */
export function setInstallRecord(
  home: string,
  id: string,
  record: CachedInstallRecord | null,
): Promise<CachedInstallRecord | null> {
  const file = recordsFile(home)
  return serialize(file, async () => {
    const records = await readInstallRecords(home)
    const previous = records[id] ?? null
    if (!previous && !record) return null
    if (record) records[id] = record
    else delete records[id]
    const plugins = Object.fromEntries(
      Object.entries(records)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, [{ scope: 'user', ...value }]]),
    )
    await fs.mkdir(pluginsRoot(home), { recursive: true })
    const staged = `${file}.${randomUUID()}.tmp`
    await fs.writeFile(staged, JSON.stringify({ version: 2, plugins }, null, 2) + '\n')
    await fs.rename(staged, file)
    return previous
  })
}

const insideCache = (home: string, dir: string) =>
  isPathBelow(resolve(pluginCacheRoot(home)), resolve(dir))

/** Mark a version folder as no longer installed. Only a folder inside the cache is marked. */
export async function markOrphaned(home: string, dir: string, now: () => number = Date.now) {
  if (!insideCache(home, dir)) return
  if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) return
  await fs.writeFile(join(dir, ORPHAN_MARKER), new Date(now()).toISOString() + '\n')
}

/** A version installed again is no longer orphaned. */
export async function clearOrphaned(dir: string): Promise<void> {
  await fs.rm(join(dir, ORPHAN_MARKER), { force: true })
}

async function subdirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name))
}

/**
 * Remove every version folder marked orphaned more than `retentionMs` ago that no record points at.
 * Nothing is removed while no install is recorded at all, as in Claude Code. Returns what it removed.
 */
export async function sweepOrphanedVersions(
  home: string,
  opts: { now?: () => number; retentionMs?: number } = {},
): Promise<string[]> {
  const records = Object.values(await readInstallRecords(home))
  if (records.length === 0) return []
  const live = new Set(records.map((record) => resolve(record.installPath)))
  const now = (opts.now ?? Date.now)()
  const retention = opts.retentionMs ?? ORPHAN_RETENTION_MS
  const removed: string[] = []
  for (const market of await subdirs(pluginCacheRoot(home)))
    for (const plugin of await subdirs(market))
      for (const version of await subdirs(plugin)) {
        if (live.has(resolve(version))) continue
        const marked = await fs.readFile(join(version, ORPHAN_MARKER), 'utf8').catch(() => null)
        const at = marked ? Date.parse(marked.trim()) : Number.NaN
        if (Number.isNaN(at) || now - at <= retention) continue
        await rmrf(version)
        removed.push(version)
      }
  return removed
}
