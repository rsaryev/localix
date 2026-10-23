import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, join } from 'node:path'

import { MINI_APP_UI_ARTIFACT_DIR } from '@localixai/mini-app-sdk/ui-artifact'

import { retainPreviousHashedFiles } from './authoring/ui-retained-files'

/**
 * One managed copy of a bundled plugin under `~/.localix/plugins/<name>`: how it is installed,
 * how the copy it replaces is kept alive, and when the kept copies are swept. `bundled-install.ts`
 * decides WHICH plugins need a copy; this module owns the filesystem act.
 */

/** Marks a directory as a first-party copy this process may refresh; user installs carry none. */
export const MARKER_FILE = '.localix-managed.json'
export const MARKER_KIND = 'localix-bundled-plugin'
/** Retired copies: the `.sync-` prefix keeps them invisible to discovery like every sync artifact. */
const RETIRED_PREFIX = '.sync-retired-'

/**
 * The content fingerprint a managed copy was installed with, or null for a directory that is not
 * one of ours (a user install) or whose marker is unreadable. The fingerprint is a hash of the
 * whole staged tree, so a caller keying derived data on it is invalidated by every re-stage.
 */
export async function readManagedFingerprint(dir: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, MARKER_FILE), 'utf8')) as {
      kind?: unknown
      fingerprint?: unknown
    }
    return parsed.kind === MARKER_KIND && typeof parsed.fingerprint === 'string'
      ? parsed.fingerprint
      : null
  } catch {
    return null
  }
}

/**
 * Install `sourceDir` as the managed copy at `installDir`, atomically: a complete temp copy,
 * then one rename. The previous copy is RETIRED (renamed aside), not deleted. Its backend
 * bundle may be the module this process is executing right now, and the development runtime
 * is `bun --watch`, which reloads the whole API the moment a file it imported is unlinked
 * (measured: rename-aside leaves it alone; `rm` of the renamed tree reloads). That reload is
 * what killed an agent turn mid-`bash` after a plugin was re-staged. Retired trees are swept by
 * {@link pruneRetiredManagedCopies} on the next process start, before anything is imported.
 */
export async function installManagedCopy(
  sourceDir: string,
  installDir: string,
  fingerprint: string,
): Promise<void> {
  const parent = join(installDir, '..')
  const tempDir = join(parent, `.sync-${basename(installDir)}-${process.pid}-${randomUUID()}`)
  const retiredDir = join(
    parent,
    `${RETIRED_PREFIX}${basename(installDir)}-${process.pid}-${randomUUID()}`,
  )
  let hasRetired = false
  await fs.mkdir(parent, { recursive: true })
  try {
    await fs.cp(sourceDir, tempDir, { recursive: true })
    // Staging may have advanced past the revision an open tab imported. Retain the installed
    // revision's lazy chunks as well, before replacing the directory the API serves them from.
    const stagedUi = join(tempDir, MINI_APP_UI_ARTIFACT_DIR)
    if (existsSync(stagedUi)) {
      await retainPreviousHashedFiles(join(installDir, MINI_APP_UI_ARTIFACT_DIR), stagedUi)
    }
    await fs.writeFile(
      join(tempDir, MARKER_FILE),
      `${JSON.stringify({ kind: MARKER_KIND, fingerprint }, null, 2)}\n`,
    )
    try {
      await fs.rename(installDir, retiredDir)
      hasRetired = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await fs.rename(tempDir, installDir)
    } catch (error) {
      if (hasRetired) {
        await fs.rename(retiredDir, installDir)
        hasRetired = false
      }
      throw error
    }
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/**
 * Retire a managed copy whose plugin no longer ships: renamed aside exactly like a replaced copy
 * (its backend may be loaded right now, and deleting an imported file restarts `bun --watch`), and
 * swept by {@link pruneRetiredManagedCopies} on the next start. Without this a removed bundled
 * plugin lingered in `~/.localix/plugins` forever and was rediscovered on every boot.
 */
export async function retireManagedCopy(installDir: string): Promise<void> {
  const retiredDir = join(
    installDir,
    '..',
    `${RETIRED_PREFIX}${basename(installDir)}-${process.pid}-${randomUUID()}`,
  )
  await fs.rename(installDir, retiredDir)
}

/**
 * Retire every managed copy (ours, by `isManaged`) under `installRoot` whose plugin is not in
 * `shipped`. The caller proves `shipped` complete — a staged marker AND the source directory
 * agree — because a plugin mid-restage must never be unloaded. A user's own plugin carries no
 * marker and is never touched.
 */
export async function retireUnshippedManagedCopies(
  installRoot: string,
  shipped: ReadonlySet<string>,
  isManaged: (dir: string) => Promise<boolean>,
): Promise<void> {
  for (const entry of await fs.readdir(installRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || shipped.has(entry.name)) continue
    const installDir = join(installRoot, entry.name)
    if (await isManaged(installDir)) await retireManagedCopy(installDir)
  }
}

/**
 * Delete the managed copies earlier syncs retired. Safe only while nothing from them is
 * loaded, so the first sync of a process runs it before any plugin module is imported; a
 * later sync in the same process leaves them alone (see {@link installManagedCopy}).
 */
export async function pruneRetiredManagedCopies(installRoot: string): Promise<number> {
  let entries: string[]
  try {
    entries = await fs.readdir(installRoot)
  } catch {
    return 0
  }
  const retired = entries.filter((name) => name.startsWith(RETIRED_PREFIX))
  await Promise.all(
    retired.map((name) => fs.rm(join(installRoot, name), { recursive: true, force: true })),
  )
  return retired.length
}
