import type { ProviderConnection } from '@/shared/api/contracts'

type PollableConnection = Pick<ProviderConnection, 'id' | 'providerId' | 'updatedAt' | 'keyCount'>

const version = (connection: PollableConnection): string =>
  `${connection.id}:${connection.updatedAt}:${connection.keyCount}`

/**
 * Finds the connection created or updated by one OAuth flow. Comparing a stable
 * version instead of only the id lets re-authorization repair an existing
 * zero-key connection without rebinding the session to an unrelated provider.
 */
export function findChangedOAuthConnection<T extends PollableConnection>(
  baseline: readonly T[],
  current: readonly T[],
  providerId: string,
): T | undefined {
  const knownVersions = new Set<string>()
  for (const connection of baseline) {
    if (connection.providerId === providerId) knownVersions.add(version(connection))
  }
  return current.find(
    (connection) => connection.providerId === providerId && !knownVersions.has(version(connection)),
  )
}

/** Bounded OAuth polling keeps running while the system browser covers the app. */
export function startOAuthConnectionPoll<T extends PollableConnection>(options: {
  baseline: readonly T[]
  providerId: string
  refresh: () => Promise<void>
  read: () => readonly T[]
  onConnected: (connection: T, signal: AbortSignal) => Promise<void>
  onTimeout: () => void
  onStop: () => void
  schedule?: (tick: () => void) => () => void
  maxAttempts?: number
}): () => void {
  let attempts = 0
  let stopped = false
  const controller = new AbortController()
  let cancelTimer: (() => void) | undefined
  const schedule =
    options.schedule ??
    ((tick) => {
      const timer = setTimeout(tick, 3000)
      return () => clearTimeout(timer)
    })
  const stop = () => {
    if (stopped) return
    stopped = true
    controller.abort()
    cancelTimer?.()
    options.onStop()
  }
  const tick = async () => {
    if (stopped) return
    attempts += 1
    try {
      await options.refresh()
      if (stopped) return
      const connection = findChangedOAuthConnection(
        options.baseline,
        options.read(),
        options.providerId,
      )
      if (connection) {
        await options.onConnected(connection, controller.signal)
        stop()
        return
      }
    } catch {
      // A transient read or binding failure can retry within the same deadline.
    }
    if (stopped) return
    if (attempts >= (options.maxAttempts ?? 40)) {
      stop()
      options.onTimeout()
    } else {
      cancelTimer = schedule(() => void tick())
    }
  }
  cancelTimer = schedule(() => void tick())
  return stop
}
