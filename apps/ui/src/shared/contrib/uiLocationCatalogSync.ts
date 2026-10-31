import { client, unwrap } from '@/shared/api/internal'
import { eventSocket } from '@/shared/api/eventSocket'
import { type UiAgentLocationCatalogSnapshot, enqueueMicrotask } from '@localixai/mini-app-sdk/ui'
import { createBoundedCache } from '@localixai/kit/lib'
import { createUiLocationCatalogSync } from './uiLocationCatalogPublisher'
import { subscribeUiLocations, uiAgentLocationCatalogSnapshot } from './uiLocations'
import { tabPublisherId } from './uiLocationPublisherId'

const WORKBENCH_UI_CAPABILITY = 'workbench-ui'
const CATALOG_READY_WAIT_MS = 1_500
const MAX_REMEMBERED_PROJECT_CATALOGS = 32
const HOME_SCOPE_KEY = '\u0000home'

const publisherId = tabPublisherId()

let activeCatalog: {
  owner: symbol
  projectId: string | null
  catalogId: string
} | null = null
let catalogReadiness: {
  owner: symbol
  projectId: string | null
  promise: Promise<void>
  resolve: () => void
} | null = null
const catalogIdsByProject = createBoundedCache<string, string>({
  maxEntries: MAX_REMEMBERED_PROJECT_CATALOGS,
})

function beginCatalogReadiness(owner: symbol, projectId: string | null): void {
  if (catalogReadiness?.owner === owner) return
  // Wake callers following a replaced route so their loop can observe the new
  // owner instead of waiting on a latch that can no longer publish.
  catalogReadiness?.resolve()
  let resolveReadiness!: () => void
  const promise = new Promise<void>((resolve) => {
    resolveReadiness = resolve
  })
  catalogReadiness = { owner, projectId, promise, resolve: resolveReadiness }
}

function projectKey(projectId: string | null): string {
  return projectId ?? HOME_SCOPE_KEY
}

function rememberProjectCatalog(projectId: string | null, catalogId: string): void {
  catalogIdsByProject.set(projectKey(projectId), catalogId)
}

/** Client surface bound to the immutable catalog most recently published for this route. */
export function workbenchToolSurface(projectId?: string | null): {
  capabilities: string[]
  catalogs?: Record<string, string>
} {
  const catalogId =
    projectId === undefined
      ? activeCatalog?.catalogId
      : catalogIdsByProject.peek(projectKey(projectId))
  return {
    capabilities: [WORKBENCH_UI_CAPABILITY],
    ...(catalogId ? { catalogs: { [WORKBENCH_UI_CAPABILITY]: catalogId } } : {}),
  }
}

async function waitForWorkbenchToolSurface(
  waitMs: number,
  projectId?: string | null,
): Promise<ReturnType<typeof workbenchToolSurface>> {
  const deadline = Date.now() + waitMs
  while (!activeCatalog && catalogReadiness && Date.now() < deadline) {
    // An explicit project retry must never follow the active route into another
    // scope. It can use that project's last immutable publication instead.
    if (projectId !== undefined && catalogReadiness.projectId !== projectId) break
    const readiness = catalogReadiness
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      readiness.promise,
      new Promise<void>((resolve) => {
        timer = globalThis.setTimeout(resolve, Math.max(0, deadline - Date.now()))
      }),
    ])
    if (timer !== undefined) globalThis.clearTimeout(timer)
    // A route change resolves the old owner's latch and installs a new one.
    // Active sends follow the replacement; project-bound retries do not.
  }
  return workbenchToolSurface(projectId)
}

/**
 * Resolve the workbench surface for a run, briefly waiting for the active route's
 * first immutable catalog publication. This closes the startup/scope-switch race
 * where a send carried the workbench capability but no catalog id, leaving
 * `localix_ui.find` with an empty destination set for the whole run.
 *
 * No active sync (tests/non-workbench embedding), an already-published catalog,
 * and teardown all return immediately. A failed sidecar remains bounded so chat
 * sending never depends indefinitely on an auxiliary catalog.
 */
export async function readyWorkbenchToolSurface(
  waitMs: number = CATALOG_READY_WAIT_MS,
): Promise<ReturnType<typeof workbenchToolSurface>> {
  return waitForWorkbenchToolSurface(waitMs)
}

/**
 * Resolve a surface for a known session project. If that project is the active
 * route, wait for its fresh publication; otherwise reuse only its last immutable
 * project-scoped catalog. The backend revalidates the id against the session
 * owner and project before exposing any destination to the agent.
 */
export async function readyWorkbenchToolSurfaceForProject(
  projectId: string | null,
  waitMs: number = CATALOG_READY_WAIT_MS,
): Promise<ReturnType<typeof workbenchToolSurface>> {
  const activeProjectId = catalogReadiness?.projectId ?? activeCatalog?.projectId
  if (activeProjectId === projectId) return waitForWorkbenchToolSurface(waitMs, projectId)
  return workbenchToolSurface(projectId)
}

async function publishCatalogSnapshot(
  projectId: string | null,
  catalog: UiAgentLocationCatalogSnapshot,
) {
  return unwrap(
    await client.rpc['ui-locations'].catalog.$put({ json: { publisherId, projectId, catalog } }),
  )
}

export { createUiLocationCatalogSync } from './uiLocationCatalogPublisher'
export type { UiLocationCatalogSyncPorts } from './uiLocationCatalogPublisher'

/**
 * Bind the live registry to the backend catalog for one route.
 *
 * `whenContributionsReady` is REQUIRED, and it is the reason core UI surfaces can
 * be discovered off the startup path at all: core `*.surface` declarations are a
 * staged phase (see `discover.ts`), so a publication scheduled at module
 * evaluation would hand the agent a catalog missing every colocated destination
 * and only correct it on the invalidation follow-up. Gating the work queue keeps
 * the FIRST publication a complete one. The readiness latch is armed
 * synchronously below, so an early send waits for that catalog instead of racing
 * a partial one.
 */
export function startUiLocationCatalogSync(
  projectId: string | null,
  whenContributionsReady: Promise<void>,
): () => void {
  const owner = Symbol('ui-location-catalog-sync')
  // Never attach a request for the new route to a snapshot published for an
  // older route or mini app inventory. The tool safely remains raw-URI-only until
  // this owner has published its complete snapshot.
  activeCatalog = null
  catalogIdsByProject.delete(projectKey(projectId))
  beginCatalogReadiness(owner, projectId)
  // Failed discovery must not strand the sidecar: publish whatever did register
  // rather than leaving the agent with no catalog at all. `discoverUi` owns
  // reporting that failure.
  const afterContributions = (run: () => void) => {
    void whenContributionsReady.then(run, run)
  }
  const stop = createUiLocationCatalogSync(projectId, {
    snapshot: uiAgentLocationCatalogSnapshot,
    publish: publishCatalogSnapshot,
    subscribeLocations: subscribeUiLocations,
    subscribeReconnect: (listener) => eventSocket.onReconnect(listener),
    // Browser host functions may require `window` as their receiver. Wrapping
    // them also keeps this port safe in WebKit/Tauri implementations that reject
    // detached `Window.queueMicrotask` calls as illegal invocations.
    queue: (run) => afterContributions(() => enqueueMicrotask(run)),
    scheduleRetry: (run, delayMs) => setTimeout(run, delayMs),
    cancelRetry: (timer) => clearTimeout(timer),
    onInvalidated: () => {
      if (activeCatalog?.owner === owner) activeCatalog = null
      catalogIdsByProject.delete(projectKey(projectId))
      beginCatalogReadiness(owner, projectId)
    },
    onPublished: (catalogId) => {
      rememberProjectCatalog(projectId, catalogId)
      activeCatalog = { owner, projectId, catalogId }
      if (catalogReadiness?.owner === owner) {
        catalogReadiness.resolve()
        catalogReadiness = null
      }
    },
  })
  return () => {
    stop()
    if (activeCatalog?.owner === owner) activeCatalog = null
    if (catalogReadiness?.owner === owner) {
      catalogReadiness.resolve()
      catalogReadiness = null
    }
  }
}
