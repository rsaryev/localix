import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, type Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DiscoveredMiniApp } from './discovery'
import { readManagedFingerprint } from './managed-copy'
import type { inspectMiniAppTools } from './native'

/**
 * Mini app tool inspections that survive a restart.
 *
 * The defect this stops: the capability snapshot names each enabled mini app's tools by importing
 * its backend and calling `register()` (`inspectMiniAppTools`), and that answer lived only in the
 * service's memory. So EVERY launch imported every backend bundle (~20 bundles, 14 MB, ~265 ms)
 * before the first snapshot could answer, and the UI's mini app rail waited on it. The answer
 * rarely changes between launches, so it is kept on disk and a launch whose inputs are unchanged
 * serves it without running any mini app code.
 *
 * What makes an entry valid is stated by {@link durableInspectionFingerprint}: the in-memory
 * fingerprint (manifest, config digest, entry mtime/size, user, cwd) PLUS evidence that neither
 * the mini app's code nor the host that inspects it changed — the fingerprint a managed copy was
 * installed with, or for a user install a stat of its tree. Lifecycle changes (enable, config,
 * install, remove, reload) drop entries explicitly, exactly as they drop the in-memory ones. A
 * failed inspection is never stored, and a file that does not parse is an empty cache.
 */

export type MiniAppToolInspection = Awaited<ReturnType<typeof inspectMiniAppTools>>

interface StoredInspection {
  app: string
  projectId: string
  fingerprint: string
  result: MiniAppToolInspection
}

const STORE_VERSION = 1
const STORE_FILE = 'mini-app-inspection-cache-v1.json'
const MAX_STORED = 256
/** Twenty mini apps finish inspecting within one burst; coalesce them into one write. */
const WRITE_COALESCE_MS = 50
/** A user mini app tree bigger than this is not stat-walked per launch; it stays memory-only. */
const MAX_TREE_ENTRIES = 2_000
const SKIPPED_TREE_DIRS = new Set(['node_modules', '.git'])

/**
 * The host build: the file this code is running from. Packaged, that is the server bundle, which
 * changes with every release — and a release can change what inspection reports (tool-name
 * policy, the context `register()` receives) for a mini app whose own files did not change.
 */
let hostStamp: Promise<string> | null = null
function hostBuildStamp(): Promise<string> {
  hostStamp ??= fs
    .stat(fileURLToPath(import.meta.url))
    .then((stat) => `${stat.mtimeMs}:${stat.size}`)
    .catch(() => 'unknown')
  return hostStamp
}

/**
 * mtime/size of every file a user mini app's entry could import. A user install has no content
 * marker, and the entry's own stat (the in-memory key) misses an edit to a sibling module the
 * entry imports — which a restart, unlike an in-process re-import, WOULD pick up. `node_modules`
 * is represented by its own directory stat (an install or removal) rather than walked.
 */
async function userTreeStamp(root: string): Promise<string | null> {
  const found: string[] = []
  let overflow = false
  const visit = async (path: string): Promise<void> => {
    if (overflow) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(path, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (entry) => {
        const child = join(path, entry.name)
        const stat = await fs.stat(child).catch(() => null)
        if (!stat) return
        if (found.push(`${child}\u0000${stat.mtimeMs}\u0000${stat.size}`) > MAX_TREE_ENTRIES) {
          overflow = true
          return
        }
        if (entry.isDirectory() && !SKIPPED_TREE_DIRS.has(entry.name)) await visit(child)
      }),
    )
  }
  await visit(root)
  return overflow ? null : found.sort().join('\n')
}

/**
 * The key a stored inspection must match, or null when this mini app's inspection is not persisted
 * (a user tree too large to stat cheaply). `memoryFingerprint` is the service's own key digest.
 */
export async function durableInspectionFingerprint(
  miniApp: DiscoveredMiniApp,
  memoryFingerprint: string,
): Promise<string | null> {
  const managed = await readManagedFingerprint(miniApp.dir)
  const code = managed ? `managed:${managed}` : await userTreeStamp(miniApp.dir)
  if (code === null) return null
  return createHash('sha256')
    .update(JSON.stringify([STORE_VERSION, await hostBuildStamp(), memoryFingerprint, code]))
    .digest('hex')
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

function isInspection(value: unknown): value is MiniAppToolInspection {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.tools) &&
    v.tools.every(
      (tool) =>
        tool &&
        typeof tool === 'object' &&
        typeof (tool as Record<string, unknown>).name === 'string' &&
        typeof (tool as Record<string, unknown>).label === 'string' &&
        typeof (tool as Record<string, unknown>).description === 'string',
    ) &&
    (
      [
        'backendSubsystems',
        'routeMounts',
        'resourceProviders',
        'searchProviders',
        'contextProviders',
        'wsCommands',
        'channels',
      ] as const
    ).every((field) => isStringArray(v[field])) &&
    v.error === undefined
  )
}

function isStored(value: unknown): value is StoredInspection {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.app === 'string' &&
    typeof v.projectId === 'string' &&
    typeof v.fingerprint === 'string' &&
    isInspection(v.result)
  )
}

export interface MiniAppInspectionStore {
  /** The stored result for `key` when it was recorded under exactly `fingerprint`. */
  get(key: string, fingerprint: string): Promise<MiniAppToolInspection | null>
  set(key: string, entry: StoredInspection): void
  /** Drop every entry `match` selects (a lifecycle change); no argument drops all. */
  drop(match?: (entry: { app: string; projectId: string }) => boolean): void
  /** Settle any pending write. Tests and shutdown only. */
  flush(): Promise<void>
}

/** The on-disk inspection store of one Localix home: `<home>/.localix/cache/<STORE_FILE>`. */
export function createMiniAppInspectionStore(homeDir: string): MiniAppInspectionStore {
  const file = join(homeDir, '.localix', 'cache', STORE_FILE)
  // Keyed by a digest: the raw key carries the mini app path, user and cwd.
  const digest = (key: string) => createHash('sha256').update(key).digest('hex')
  let entries: Promise<Map<string, StoredInspection>> | null = null
  const load = (): Promise<Map<string, StoredInspection>> => {
    entries ??= fs
      .readFile(file, 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text) as { version?: unknown; entries?: unknown }
        if (parsed.version !== STORE_VERSION || !parsed.entries) return new Map()
        return new Map(
          Object.entries(parsed.entries as Record<string, unknown>).filter(
            (pair): pair is [string, StoredInspection] => isStored(pair[1]),
          ),
        )
      })
      .catch(() => new Map<string, StoredInspection>())
    return entries
  }

  let writing: Promise<void> | null = null
  let dirty = false
  const write = async (): Promise<void> => {
    const map = await load()
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(dirname(file), { recursive: true })
      await fs.writeFile(
        temp,
        JSON.stringify({ version: STORE_VERSION, entries: Object.fromEntries(map) }),
      )
      await fs.rename(temp, file)
    } catch {
      // An unwritable home only loses the optimization; the snapshot is already answered.
      await fs.rm(temp, { force: true }).catch(() => {})
    }
  }
  const scheduleWrite = (): void => {
    dirty = true
    if (writing) return
    writing = (async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, WRITE_COALESCE_MS).unref?.())
      while (dirty) {
        dirty = false
        await write()
      }
    })().finally(() => {
      writing = null
    })
  }

  return {
    async get(key, fingerprint) {
      const stored = (await load()).get(digest(key))
      return stored?.fingerprint === fingerprint ? stored.result : null
    },
    set(key, entry) {
      void load().then((map) => {
        const id = digest(key)
        map.delete(id)
        map.set(id, entry)
        while (map.size > MAX_STORED) {
          const oldest = map.keys().next().value
          if (oldest === undefined) break
          map.delete(oldest)
        }
        scheduleWrite()
      })
    },
    drop(match) {
      void load().then((map) => {
        let changed = false
        for (const [id, entry] of map) {
          if (!match || match(entry)) changed = map.delete(id) || changed
        }
        if (changed) scheduleWrite()
      })
    },
    async flush() {
      await load()
      // `set`/`drop` schedule after `load` settles; let those continuations run first.
      await new Promise<void>((resolve) => setImmediate(resolve))
      while (writing) await writing
    },
  }
}
