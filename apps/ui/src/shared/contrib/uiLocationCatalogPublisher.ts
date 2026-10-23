import type { UiAgentLocationCatalogSnapshot } from '@localixai/mini-app-sdk/ui'
import { backoffMs } from '@localixai/api/backoff'
import { ApiError } from '@/shared/api/internal'

/** First retry after a failed publish; each further failure doubles it up to the cap. A flat
 *  one-second retry hammered a restarting API for the whole outage, and a failed non-GET
 *  raises an incident — so one restart became a stream of "PUT ui-locations failed". The
 *  reconnect subscription re-publishes anyway, so the retry need not poll for recovery. */
const RETRY_BACKOFF = { baseMs: 1_000, maxMs: 30_000 }

/**
 * The route's project does not exist (an id from a recreated database, or a project deleted
 * elsewhere). No retry can fix that and no person caused it: the route itself is redirected
 * off the dead scope (`useUrlStoreSync`), which stops this publisher. Until then it stays quiet.
 */
export function isMissingCatalogProject(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'project_not_found'
}

export interface UiLocationCatalogSyncPorts {
  snapshot(): UiAgentLocationCatalogSnapshot
  publish(
    projectId: string | null,
    snapshot: UiAgentLocationCatalogSnapshot,
  ): Promise<{ catalogId: string }>
  subscribeLocations(listener: () => void): () => void
  subscribeReconnect(listener: () => void): () => void
  queue(run: () => void): void
  scheduleRetry(run: () => void, delayMs: number): ReturnType<typeof setTimeout>
  cancelRetry(timer: ReturnType<typeof setTimeout>): void
  /** The last published catalog no longer describes the live registry. */
  onInvalidated?(): void
  onPublished(catalogId: string): void
}

/**
 * Publish a coalesced whole snapshot and keep it converged across registry
 * changes and API reconnects. The frontend revision is only a dirty signal;
 * backend identity is derived from normalized catalog content.
 */
export function createUiLocationCatalogSync(
  projectId: string | null,
  ports: UiLocationCatalogSyncPorts,
): () => void {
  let stopped = false
  let dirty = true
  let force = true
  let running = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryFailures = 0
  let lastContent = ''
  let publishedContent = ''

  const schedule = (forcePublish = false) => {
    if (stopped) return
    dirty = true
    force ||= forcePublish
    ports.queue(() => {
      void flush()
    })
  }

  const flush = async () => {
    if (stopped || running || !dirty) return
    running = true
    dirty = false
    const snapshot = ports.snapshot()
    const content = JSON.stringify(snapshot.locations)
    const shouldPublish = force || content !== lastContent
    force = false
    if (!shouldPublish) {
      running = false
      if (dirty) void flush()
      return
    }
    try {
      const result = await ports.publish(projectId, snapshot)
      if (stopped) return
      lastContent = content
      // A registry mutation can land while this request is in flight. Never
      // advertise that superseded immutable id; the dirty follow-up publishes
      // the current snapshot and releases readiness instead.
      const currentContent = JSON.stringify(ports.snapshot().locations)
      if (content === currentContent) {
        publishedContent = content
        ports.onPublished(result.catalogId)
      }
      retryTimer = null
      retryFailures = 0
    } catch (error) {
      if (stopped) return
      if (projectId !== null && isMissingCatalogProject(error)) {
        stopped = true
        return
      }
      // One warning per outage, not one per attempt — the streak is a single condition.
      if (retryFailures === 0) {
        console.warn('[ui-locations] catalog sync failed; retrying', error)
      }
      force = true
      dirty = true
      if (retryTimer === null) {
        const delay = backoffMs(retryFailures++, RETRY_BACKOFF)
        retryTimer = ports.scheduleRetry(() => {
          retryTimer = null
          void flush()
        }, delay)
      }
    } finally {
      running = false
      if (dirty && retryTimer === null) void flush()
    }
  }

  const unsubscribeLocations = ports.subscribeLocations(() => {
    const content = JSON.stringify(ports.snapshot().locations)
    if (content !== publishedContent) ports.onInvalidated?.()
    schedule()
  })
  const unsubscribeReconnect = ports.subscribeReconnect(() => schedule(true))
  schedule(true)

  return () => {
    stopped = true
    unsubscribeLocations()
    unsubscribeReconnect()
    if (retryTimer !== null) ports.cancelRetry(retryTimer)
  }
}
