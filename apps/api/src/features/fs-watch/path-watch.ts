import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'

import { isPathBelow } from '../../lib/path-containment'
import { subscribeNative } from './subscribe'

/**
 * `fs.watch`'s shape — a file or a directory, recursive or not, entry names relative to the
 * watched path — served by the native watcher, for callers (mini app backends) that cannot load the
 * addon themselves.
 *
 * Bun's recursive `fs.watch` on macOS delivers only part of a burst, so a caller trusting it as a
 * change signal silently waits for its backstop poll. The native backend subscribes DIRECTORIES
 * and always recursively, so the two shapes it lacks are built here:
 * - a FILE is watched through its parent directory, filtered to its own name;
 * - a non-recursive watch ignores nested entries natively (`*\/**`), so on inotify no kernel watch
 *   is ever added below the first level.
 *
 * The subscription is on the REAL path (FSEvents reports real paths, and the native ignore globs
 * match relative to the subscribed root), and reported names are relative to it either way.
 */
export function watchPathNative(
  target: string,
  recursive: boolean,
  onEvent: (name: string | null) => void,
  onError: () => void,
): () => void {
  let real: string
  let isDir: boolean
  try {
    real = realpathSync(target)
    isDir = statSync(real).isDirectory()
  } catch {
    onError()
    return () => {}
  }
  const dir = isDir ? real : path.dirname(real)
  const fileName = isDir ? null : path.basename(real)
  const handle = subscribeNative(
    dir,
    (events) => {
      for (const event of events) {
        if (!isPathBelow(dir, event.path)) continue
        const rel = path.relative(dir, event.path)
        if (fileName !== null) {
          if (rel === fileName) onEvent(fileName)
          continue
        }
        onEvent(rel.split(path.sep).join('/'))
      }
    },
    {
      ...(recursive && fileName === null ? {} : { ignore: ['*/**'] }),
      onError: () => onError(),
    },
  )
  return () => handle.close()
}
