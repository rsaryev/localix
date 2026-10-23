import { dirName } from '@localixai/mini-app-sdk/ui/utilities'

/**
 * Pure decision logic for the open-editor external-change reconciler. Kept out of
 * the `useFileEditor` hook so the branching is unit-testable without a renderer.
 */

/** What a fresh on-disk read should do to the open buffer. */
export type DiskChangeAction = 'none' | 'adopt' | 'conflict'

/**
 * Classify an on-disk change relative to the open buffer:
 * - `none`    — no real change (disk hash matches the loaded base, or unknown).
 * - `adopt`   — disk changed and the buffer is clean → silently reload.
 * - `conflict`— disk changed and the buffer is dirty → surface reconcile banner.
 */
export function classifyDiskChange(
  diskHash: string | null | undefined,
  baseHash: string,
  dirty: boolean,
): DiskChangeAction {
  if (diskHash == null || diskHash === baseHash) return 'none'
  return dirty ? 'conflict' : 'adopt'
}

/**
 * Whether a coarse FS-watch frame (a set of changed DIRECTORY paths) touches the
 * open file. An empty set is the watcher's "reload everything" signal, so it always
 * matches; otherwise the file's own directory must be in the set.
 */
export function fsChangeTouchesFile(changedDirs: readonly string[], filePath: string): boolean {
  if (!changedDirs.length) return true
  return changedDirs.includes(dirName(filePath))
}
