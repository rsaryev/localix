import { watch } from 'node:fs'

/**
 * Tell `onChange` when a settings file of `dirs` is written, created or removed — Claude Code
 * reloads settings as they are saved. Returns the stop function. A folder that is not there is
 * not watched, and a watcher that cannot start leaves the line to its other triggers.
 */
export function watchSettingsDirs(dirs: readonly string[], onChange: () => void): () => void {
  const watchers = dirs.flatMap((dir) => {
    try {
      const watcher = watch(dir, { persistent: false }, (_event, file) => {
        if (!file || String(file).startsWith('settings')) onChange()
      })
      watcher.on('error', () => watcher.close())
      return [watcher]
    } catch {
      return []
    }
  })
  return () => {
    for (const watcher of watchers) watcher.close()
  }
}
