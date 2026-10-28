import { existsSync, statSync, utimesSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'

/**
 * WHEN AN OLDER VERSION OF A LANGUAGE SERVER MAY GO (`lsp-installer.ts`). A version folder is
 * used by a server that stays running while Localix updates, and by every Localix sharing
 * `~/.localix` (a dev build beside a packaged one), so a new install removes only what nothing
 * can be running from: never a folder this process handed out, never one launched within
 * `UNUSED_GRACE_MS`. A launch is the modification time of the version's `.complete`.
 */

/** Written last into a finished install. */
export const COMPLETE = '.complete'
/** Prefix of an install in progress. */
export const STAGING = '.staging-'
/** How long an older version must have gone unlaunched before a new install removes it. */
export const UNUSED_GRACE_MS = 30 * 24 * 60 * 60 * 1000

/** Mark a complete install as launched now, for other processes' pruning. */
export function markUsed(dir: string, at: Date): void {
  try {
    utimesSync(path.join(dir, COMPLETE), at, at)
  } catch {
    // Read-only or gone: the install is still complete.
  }
}

/** Remove the versions in `parent` besides `keep` that are not in use anywhere. */
export async function pruneUnused(
  parent: string,
  keep: string,
  handedOut: ReadonlySet<string>,
  now: Date,
): Promise<void> {
  for (const name of await readdir(parent).catch(() => [])) {
    const folder = path.join(parent, name)
    if (name === keep || name.startsWith(STAGING) || handedOut.has(folder)) continue
    const marker = path.join(folder, COMPLETE)
    const lastUsed = (existsSync(marker) ? statSync(marker) : statSync(folder)).mtimeMs
    if (now.getTime() - lastUsed < UNUSED_GRACE_MS) continue
    await rm(folder, { recursive: true, force: true }).catch(() => {})
  }
}
