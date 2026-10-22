import type { ProviderConnection } from '@/shared/api/contracts'

type WatchedConnection = Pick<ProviderConnection, 'id' | 'providerId' | 'updatedAt' | 'keyCount'>

const version = (connection: WatchedConnection): string =>
  `${connection.id}:${connection.updatedAt}:${connection.keyCount}`

/** How long a sign-in in the system browser may take before the flow gives up. */
const SIGN_IN_DEADLINE_MS = 120_000
/** A binding that failed (the session update) is tried again this soon, within the deadline. */
const BIND_RETRY_MS = 3000

/**
 * Finds the connection created or updated by one OAuth flow. Comparing a stable
 * version instead of only the id lets re-authorization repair an existing
 * zero-key connection without rebinding the session to an unrelated provider.
 */
export function findChangedOAuthConnection<T extends WatchedConnection>(
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

/**
 * Waits for the connection one OAuth flow creates or repairs. The server announces every
 * connection change and pokes `providers`, which the connections list re-reads
 * (`connectionsSync.ts`), so this watches that list rather than asking the server again: it looks
 * at once, on every change, and gives up at the deadline while the system browser covers the app.
 */
export function watchOAuthConnection<T extends WatchedConnection>(options: {
  baseline: readonly T[]
  providerId: string
  read: () => readonly T[]
  /** Fires when the list `read` returns may have changed. */
  subscribe: (listener: () => void) => () => void
  onConnected: (connection: T, signal: AbortSignal) => Promise<void>
  onTimeout: () => void
  onStop: () => void
  timer?: (ms: number, fire: () => void) => () => void
  deadlineMs?: number
}): () => void {
  const timer =
    options.timer ??
    ((ms, fire) => {
      const handle = setTimeout(fire, ms)
      return () => clearTimeout(handle)
    })
  const controller = new AbortController()
  let stopped = false
  let binding = false
  let cancelRetry: (() => void) | undefined
  const stop = () => {
    if (stopped) return
    stopped = true
    controller.abort()
    unsubscribe()
    cancelDeadline()
    cancelRetry?.()
    options.onStop()
  }
  const check = async () => {
    if (stopped || binding) return
    const connection = findChangedOAuthConnection(
      options.baseline,
      options.read(),
      options.providerId,
    )
    if (!connection) return
    binding = true
    try {
      await options.onConnected(connection, controller.signal)
      stop()
    } catch {
      // The connection is there but binding it failed (a transient session update): try again.
      if (!stopped) cancelRetry = timer(BIND_RETRY_MS, () => void check())
    } finally {
      binding = false
    }
  }
  const unsubscribe = options.subscribe(() => void check())
  const cancelDeadline = timer(options.deadlineMs ?? SIGN_IN_DEADLINE_MS, () => {
    if (stopped) return
    stop()
    options.onTimeout()
  })
  // The server can finish before the flow starts watching: what is already listed counts.
  void check()
  return stop
}
