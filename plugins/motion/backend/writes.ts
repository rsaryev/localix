import { resolve } from 'node:path'

/**
 * One mutation at a time per workspace, for EVERY caller in the process: the host calls
 * `register(ctx)` for the backend and again for each run's tools, so the queue lives at module
 * level. Listeners (the store feed) hear a path only after its write landed, so a view that
 * re-reads on the nudge never sees the value before it. File edits made outside the plugin reach
 * the view through the feed's directory watch instead.
 */
const queues = new Map<string, Promise<unknown>>()
const writeListeners = new Set<(path: string) => void>()

export function serialize<T>(workspace: string, action: () => Promise<T>): Promise<T> {
  const key = resolve(workspace)
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(action)
  queues.set(key, next)
  void next
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key)
    })
    .catch(() => {})
  return next
}

export function onStoreWrite(listener: (path: string) => void): () => void {
  writeListeners.add(listener)
  return () => {
    writeListeners.delete(listener)
  }
}

export function announceWrite(path: string) {
  for (const listener of writeListeners) {
    try {
      listener(path)
    } catch {
      /* a listener's failure must not fail the write that already landed */
    }
  }
}
