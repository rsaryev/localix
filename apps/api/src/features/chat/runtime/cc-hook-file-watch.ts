import { basename, dirname } from 'node:path'

import { watchPathNative } from '../../fs-watch/path-watch'
import type { WatchFile } from './cc-hook-sessions'

/**
 * Watch one file for `FileChanged` through its PARENT directory, filtered to its name, so a file
 * that does not exist yet reports its creation too (a file watch needs the file to exist).
 */
export const watchFileNative: WatchFile = (path, onChange) => {
  const name = basename(path)
  return watchPathNative(
    dirname(path),
    false,
    (entry) => {
      if (entry === name) onChange()
    },
    () => {},
  )
}
