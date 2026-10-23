import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'

import {
  installManagedCopy,
  MARKER_FILE,
  MARKER_KIND,
  pruneRetiredManagedCopies,
  retireUnshippedManagedCopies,
} from './managed-copy'
import { readStagedMarker, validateStagedMarker } from './staged-marker'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import { MINI_APPS_SUBDIR } from './paths'

/** Install roots whose retired copies this process already swept (once, before any import). */
const prunedRoots = new Set<string>()
const syncs = new Map<string, Promise<Set<string>>>()
/** Plugins the last pass could not copy into the install root, with the error. */
const installErrors = new Map<string, string>()
const settled = new Map<string, { at: number; result: Set<string> }>()

/**
 * How long a completed sync answers for later callers.
 *
 * The pass content-hashes every bundled plugin tree to decide whether its managed
 * copy is current — 152 MB across 897 files in the packaged build. Re-measured on
 * the shipped bundle: 93–102ms with a warm page cache, and it is the source of the
 * 910/1095ms plugin-settle outliers when cold. Deduplicating only CONCURRENT callers left a
 * startup paying that repeatedly: discovery runs once per backend-host scope, once
 * per capability snapshot, and again for the tool, command and skill catalogs that
 * reload when the snapshot publishes. The packaged log showed two of them landing
 * at 2.4s each, ~2.7s after paint.
 *
 * The window exists because the source root is NOT immutable in development —
 * dropping the memo the instant it fulfilled was how a running dev API stayed
 * honest about freshly rebuilt first-party artifacts. Ten seconds keeps that (a
 * rebuild takes longer than the window, so the next discovery after it re-syncs)
 * while a startup burst pays the walk once.
 *
 * A cheaper fingerprint — path + mode + size + mtime, the rsync/turbo answer — was
 * evaluated against the shipped bundle and REJECTED. Measured on the real tree:
 * stat-only 17ms vs content 93ms, so it buys ~76ms on a path that is already off
 * first paint, and it pays for that by losing exactly what
 * "detects same-size content changes even when timestamps are preserved" pins — a
 * release that pins build timestamps could then ship plugin code the app never
 * notices, and the user keeps running the old backend with no signal at all.
 *
 * Hashing only small files does not rescue it: the four files above 8 MB are 142 of
 * the 152 MB but only half the time (93ms → 41ms — the rest is 897 lstat calls, not
 * bytes), and three of those four ARE the plugins' `index.bundle.mjs`. That excludes
 * the shipped code from the check while keeping the check's cost.
 */
const SYNC_FRESH_MS = 10_000

interface ManagedMarker {
  kind: typeof MARKER_KIND
  fingerprint: string
}

/** A first-party plugin whose current source did not build, as the staged root records it. */
export interface BundledStagingFailure {
  name: string
  reason: string
  /** A managed copy from an earlier successful build is still installed and keeps running. */
  lastGoodCopy: boolean
}

async function fingerprintTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name === MARKER_FILE) continue
      const path = join(dir, entry.name)
      const rel = relative(root, path)
      const stat = await fs.lstat(path)
      hash.update(`${rel}\0${stat.mode}\0`)
      if (entry.isDirectory()) {
        hash.update('directory\0')
        await visit(path)
      } else if (entry.isSymbolicLink()) {
        hash
          .update('symlink\0')
          .update(await fs.readlink(path))
          .update('\0')
      } else if (entry.isFile()) {
        hash
          .update('file\0')
          .update(await fs.readFile(path))
          .update('\0')
      } else {
        hash.update(`other\0${stat.size}\0${stat.mtimeMs}\0`)
      }
    }
  }
  await visit(root)
  return hash.digest('hex')
}

/**
 * A JSON file's value: `undefined` when the file is absent, `null` when it cannot be read or does
 * not parse (still a mini app: discovery reports why).
 */
async function readJson(path: string): Promise<unknown> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function readMarker(dir: string): Promise<ManagedMarker | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(join(dir, MARKER_FILE), 'utf8'),
    ) as Partial<ManagedMarker>
    return parsed.kind === MARKER_KIND && typeof parsed.fingerprint === 'string'
      ? (parsed as ManagedMarker)
      : null
  } catch {
    return null
  }
}

async function syncOnce(sourceRoot: string, homeDir: string): Promise<Set<string>> {
  const installRoot = join(homeDir, MINI_APPS_SUBDIR)
  const managed = new Set<string>()
  if (!prunedRoots.has(installRoot)) {
    prunedRoots.add(installRoot)
    await pruneRetiredManagedCopies(installRoot)
  }
  let entries
  try {
    entries = await fs.readdir(sourceRoot, { withFileTypes: true })
  } catch {
    return managed
  }

  const pluginEntries = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    // No mini-app.json = not a mini app (a deleted one's leftover build output); staging it
    // minted an empty managed copy. A malformed manifest stays: discovery reports it.
    const manifest = await readJson(join(sourceRoot, entry.name, MINI_APP_MANIFEST_FILE))
    if (manifest === undefined) continue
    if ((manifest as { private?: unknown } | null)?.private === true) continue
    pluginEntries.push(entry)
  }
  const stagedMarker = await validateStagedMarker(
    sourceRoot,
    new Set(pluginEntries.map((entry) => entry.name)),
  )

  for (const entry of pluginEntries) {
    const sourceDir = join(sourceRoot, entry.name)
    const installDir = join(installRoot, entry.name)
    const currentMarker = await readMarker(installDir)
    const destinationExists = await fs
      .stat(installDir)
      .then(() => true)
      .catch(() => false)

    // A same-named plugin installed by the user is never overwritten or promoted
    // to trusted/bundled status. Only copies carrying our marker are refreshed.
    if (destinationExists && !currentMarker) continue

    const stagedFingerprint = stagedMarker?.pluginHashes[entry.name]
    // The staged hash is only a fast equality proof for a managed copy already
    // carrying that exact fingerprint. A missing/different on-disk marker always
    // pays the source-of-truth content walk before anything is installed or marked.
    const fingerprint =
      stagedFingerprint && currentMarker?.fingerprint === stagedFingerprint
        ? stagedFingerprint
        : await fingerprintTree(sourceDir)
    if (currentMarker?.fingerprint !== fingerprint) {
      // One plugin that cannot be copied (EPERM from a Windows file lock or antivirus, ENOSPC)
      // used to reject the whole pass, and with it every plugin in the catalog. It is recorded
      // instead; a copy it could not replace stays served.
      try {
        await installManagedCopy(sourceDir, installDir, fingerprint)
        installErrors.delete(entry.name)
      } catch (error) {
        installErrors.set(entry.name, `could not install: ${(error as Error).message}`)
        if (currentMarker) managed.add(entry.name)
        continue
      }
    }
    managed.add(entry.name)
  }

  // A managed copy (ours, by marker) whose plugin is no longer shipped is retired. "No longer
  // shipped" needs a staged marker AND agreement from both sources: absent from the marker (a
  // plugin mid-restage is still listed there) and absent from the directory (a marker may omit a
  // hash and fall back per plugin). Anything less would unload a plugin that is only being
  // rebuilt. A plugin the stager could not BUILD is still shipped: its copy from the last build
  // that worked keeps running rather than vanishing over one compile error. A user's own plugin
  // (no managed marker) is never touched.
  if (stagedMarker) {
    for (const name of Object.keys(stagedMarker.unavailable)) {
      if (await readMarker(join(installRoot, name))) managed.add(name)
    }
    const shipped = [
      ...Object.keys(stagedMarker.pluginHashes),
      ...Object.keys(stagedMarker.unavailable),
      ...pluginEntries.map((e) => e.name),
    ]
    await retireUnshippedManagedCopies(installRoot, new Set(shipped), async (dir) =>
      Boolean(await readMarker(dir)),
    )
  }
  return managed
}

/**
 * Synchronize the mini apps Localix ships into the user's mini apps root. Discovery reads the
 * resulting `.localix/mini-apps` copies; the staged source is never a second execution root.
 */
export function syncBundledMiniApps(sourceRoot: string, homeDir: string): Promise<Set<string>> {
  const key = `${sourceRoot}\0${homeDir}`
  const existing = syncs.get(key)
  if (existing) return existing
  // A recent pass answers directly. See SYNC_FRESH_MS for why the window is short
  // rather than permanent — the source root is writable in development.
  const recent = settled.get(key)
  if (recent && Date.now() - recent.at < SYNC_FRESH_MS) return Promise.resolve(recent.result)
  const pending = syncOnce(sourceRoot, homeDir)
    .then((result) => {
      settled.set(key, { at: Date.now(), result })
      return result
    })
    .finally(() => {
      if (syncs.get(key) === pending) syncs.delete(key)
    })
  syncs.set(key, pending)
  return pending
}

/**
 * The first-party plugins that are not running their current source, and why: the stager could
 * not build one (the marker's `unavailable`), or the sync could not copy one into the install
 * root. The caller raises each as a condition — before this, both were a console line in the dev
 * terminal and a plugin missing from the list.
 */
export async function bundledStagingFailures(
  sourceRoot: string,
  homeDir: string,
): Promise<BundledStagingFailure[]> {
  const installRoot = join(homeDir, MINI_APPS_SUBDIR)
  const marker = await readStagedMarker(sourceRoot)
  const reasons = new Map([...Object.entries(marker?.unavailable ?? {}), ...installErrors])
  const failures: BundledStagingFailure[] = []
  for (const [name, reason] of [...reasons].sort(([a], [b]) => a.localeCompare(b))) {
    failures.push({
      name,
      reason,
      lastGoodCopy: Boolean(await readMarker(join(installRoot, name))),
    })
  }
  return failures
}

/**
 * Forget the recently-completed pass so the NEXT discovery re-reads the source root now
 * instead of after the freshness window. The staged-root watcher calls this when the
 * marker changes, which is how a plugin re-staged while the API runs appears without
 * waiting out {@link SYNC_FRESH_MS}. An in-flight pass is left to finish.
 */
export function invalidateBundledSync(): void {
  settled.clear()
}

/** Test seam: forget both the in-flight and the recently-completed pass. */
export function __resetBundledSyncCache(): void {
  syncs.clear()
  settled.clear()
  installErrors.clear()
}
