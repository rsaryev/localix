interface ReadEntry<T> {
  promise?: Promise<T>
  value?: T
  hasValue?: boolean
  expiresAt?: number
}

export interface CoordinatedReadOptions {
  /** How long a settled read may be reused. `0` means single-flight only. */
  freshForMs?: number
  /** Ignore both a settled value and an older in-flight read. */
  force?: boolean
}

/**
 * Small client-side read coordinator for REST data shared by several mounted trading surfaces.
 *
 * React can mount the same rail more than once while moving it into the workspace, and warm tabs
 * can ask for the same immutable catalog/page at the same time. Sharing the exact read prevents
 * those lifecycle details from becoming duplicate HTTP calls. Failed reads are never cached and a
 * forced refresh gets its own flight; an older flight cannot overwrite it when it settles later.
 */
export function createReadCoordinator(now: () => number = Date.now) {
  const entries = new Map<string, ReadEntry<unknown>>()

  return {
    read<T>(key: string, options: CoordinatedReadOptions, load: () => Promise<T>): Promise<T> {
      if (options.force) entries.delete(key)

      const existing = entries.get(key) as ReadEntry<T> | undefined
      if (existing?.promise) return existing.promise
      if (existing?.hasValue && (existing.expiresAt ?? 0) > now()) {
        return Promise.resolve(existing.value as T)
      }

      const entry: ReadEntry<T> = {}
      const freshForMs = Math.max(0, options.freshForMs ?? 0)
      const result = Promise.resolve()
        .then(load)
        .then(
          (value) => {
            if (entries.get(key) !== entry) return value
            if (freshForMs > 0) {
              entry.promise = undefined
              entry.value = value
              entry.hasValue = true
              entry.expiresAt = now() + freshForMs
            } else {
              entries.delete(key)
            }
            return value
          },
          (error: unknown) => {
            if (entries.get(key) === entry) entries.delete(key)
            throw error
          },
        )

      entry.promise = result
      entries.set(key, entry)
      return result
    },

    clear(): void {
      entries.clear()
    },
  }
}
