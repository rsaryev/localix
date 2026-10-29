import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, join } from 'node:path'

import { MINI_APP_UI_ARTIFACT_DIR } from '@localixai/mini-app-sdk/ui-artifact'

import { retainPreviousHashedFiles } from './ui-retained-files'

/**
 * How an app is put under `~/.localix/mini-apps/<name>`: a complete copy swapped in with one
 * rename, the copy it replaces kept alive until the next start, and those kept copies swept. The
 * store (`store-install.ts`) and a local install (`local-install.ts`) decide WHICH app; this
 * module owns the filesystem act.
 */

/**
 * Marks a copy an earlier Localix build installed, from before X5, when the app carried its own
 * mini apps. Nothing writes it any more; it is still read so such a copy is recognized as a
 * catalog's to update, not mistaken for a folder of the person's own.
 */
export const MARKER_FILE = '.localix-managed.json'
export const MARKER_KIND = 'localix-bundled-mini-app'
/** Retired copies: the `.sync-` prefix keeps them invisible to discovery like every sync artifact. */
const RETIRED_PREFIX = '.sync-retired-'

/** Whether `dir` is such a copy. */
export async function isManagedCopy(dir: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, MARKER_FILE), 'utf8')) as {
      kind?: unknown
    }
    return parsed.kind === MARKER_KIND
  } catch {
    return false
  }
}

/**
 * Install `sourceDir` at `installDir`, atomically: a complete temp copy, then one rename. The
 * previous copy is RETIRED (renamed aside), not deleted. Its backend bundle may be the module this
 * process is executing right now, and the development runtime is `bun --watch`, which reloads the
 * whole API the moment a file it imported is unlinked (measured: rename-aside leaves it alone;
 * `rm` of the renamed tree reloads). Retired trees are swept by {@link pruneRetiredManagedCopies}
 * on the first discovery of the next process, before anything is imported. `marker` is written
 * beside the copy: the record of where it came from (a catalog's archive, a local folder).
 */
export async function installCopy(
  sourceDir: string,
  installDir: string,
  marker: { file: string; contents: unknown },
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
    await fs.writeFile(join(tempDir, marker.file), `${JSON.stringify(marker.contents, null, 2)}\n`)
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
 * Retire a copy: renamed aside exactly like a replaced one (its backend may be loaded right now,
 * and deleting an imported file restarts `bun --watch`), and swept by
 * {@link pruneRetiredManagedCopies} on the next start. Used when the person removes the app.
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
 * `.sync-retired-<app>-<pid>-<uuid>` → `<app>`. The name may hold dashes and digits of its own, so
 * the pid and the uuid are matched by their exact shape at the end.
 */
const retiredAppName = (entry: string): string | null =>
  /^\.sync-retired-(.+)-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.exec(
    entry,
  )?.[1] ?? null

/**
 * Delete the copies earlier installs retired. Safe only while nothing from them is loaded, so the
 * first discovery of a process runs it before any mini app module is imported; a later install in
 * the same process leaves them alone (see {@link installCopy}). A retired copy whose app is not
 * there any more is an install that stopped between its two renames: it is put back, not swept.
 * Returns how many were deleted.
 */
export async function pruneRetiredManagedCopies(installRoot: string): Promise<number> {
  let entries: string[]
  try {
    entries = await fs.readdir(installRoot)
  } catch {
    return 0
  }
  const retired = entries.filter((name) => name.startsWith(RETIRED_PREFIX))
  let deleted = 0
  for (const name of retired) {
    const app = retiredAppName(name)
    if (app && !entries.includes(app)) {
      await fs.rename(join(installRoot, name), join(installRoot, app))
      entries.push(app)
      continue
    }
    await fs.rm(join(installRoot, name), { recursive: true, force: true })
    deleted += 1
  }
  return deleted
}
