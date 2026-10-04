import type { Dirent } from 'node:fs'
import { opendir } from 'node:fs/promises'

/**
 * Stream at most `limit` directory entries. `readdir()` materializes an attacker-sized
 * directory before callers can slice it; this primitive makes the bound effective at I/O.
 */
export async function readDirentsLimit(
  path: string,
  limit: number,
): Promise<{ entries: Dirent[]; truncated: boolean }> {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('readDirentsLimit limit must be a non-negative safe integer')
  }
  const directory = await opendir(path)
  const entries: Dirent[] = []
  let truncated = false
  try {
    for await (const entry of directory) {
      if (entries.length >= limit) {
        truncated = true
        break
      }
      entries.push(entry)
    }
  } finally {
    // Breaking a Dir async iterator closes it automatically; explicit close covers
    // runtimes that do not, and ERR_DIR_CLOSED is the expected already-closed case.
    try {
      await directory.close()
    } catch {
      // already closed by iterator completion/break
    }
  }
  return { entries, truncated }
}
