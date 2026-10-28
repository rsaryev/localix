/**
 * The collection for WHERE the caller is — one store per project/session root, resolved per call.
 *
 * A mini app backend is wired once, so it cannot hold "the" store: the user switches session, the
 * project changes underneath it, and a captured store would keep reading the first project it ever
 * saw. Both entry points therefore ask for a root every time:
 *
 *   - a ROUTE reads `c.env.cwd`, which the host resolves per request (`MiniAppRouteScope`);
 *   - the AGENT TOOL reads `ctx.cwd`, which the per-run mini app load already sets to the session's
 *     working directory.
 *
 * Stores are memoized by root because a store is a handle to a directory, not state — building one
 * per request would be free but pointless.
 */

import path from 'node:path'
import { COLLECTION_DIR } from './paths'
import { createCollectionStore, type CollectionStore } from './store'
import { createFileEnvironmentStore } from './environments'
import { createFileEnvironmentService } from '../environments/file-service'
import { createActiveEnvironmentStore } from './active-environment'
import type { EnvironmentService } from '../environments/service'
import { getBindSecret, getResolveSecret, getStoreSecret } from '../singleton'

const byRoot = new Map<string, CollectionStore>()
const environmentsByRoot = new Map<string, EnvironmentService>()

/**
 * WHERE the active-environment pointer is remembered. Bound once at register time from
 * `ctx.stateDir` — the SDK's own per-mini-app directory, so this module never constructs a
 * `~/.localix` path itself. Unbound (a per-run tool load that never registered) falls back to the
 * collection's own folder, which keeps a send working with a pointer that simply is not shared.
 */
let stateDir: string | null = null
export function bindEnvironmentStateDir(dir: string): void {
  stateDir = dir
}

/** The collection directory for a session working directory. The host already scoped `cwd`. */
export function collectionRootFor(cwd: string): string {
  return path.join(cwd, COLLECTION_DIR)
}

/**
 * The store for a project working directory and, normally, one session.
 *
 * `cwd` may be absent — a host with no scope resolver, or a tool load without one — and the
 * fallback is the process's own directory rather than a throw: the mini app's job is to serve the
 * requests it can find, and `process.cwd()` is what every other unscoped path in this app means.
 */
export function collectionFor(cwd: string | undefined, _sessionId?: string): CollectionStore {
  const root = collectionRootFor(cwd || process.cwd())
  const existing = byRoot.get(root)
  if (existing) return existing
  const store = createCollectionStore(root)
  byRoot.set(root, store)
  return store
}

/** The environments of the collection at `cwd`, memoized the same way and for the same reason. */
export function environmentsFor(cwd: string | undefined, sessionId?: string): EnvironmentService {
  const root = collectionRootFor(cwd || process.cwd())
  const existing = environmentsByRoot.get(root)
  if (existing) return existing
  const service = createFileEnvironmentService(
    createFileEnvironmentStore(root),
    // A session-owned collection keeps its active pointer beside its JSON files. The hidden
    // state folder is skipped by the request walker and makes two sessions independent even
    // when they share the same project cwd. Unscoped collections use the mini app's state
    // directory.
    createActiveEnvironmentStore(sessionId ? path.join(root, '.state') : (stateDir ?? root)),
    root,
    // Resolve the process-wide host seams at the moment of use. Mini app inspection can create this
    // memoized service before the boot backend binds native Vault; freezing the three values here
    // would leave that collection permanently read-only and every secret save would answer 503.
    () => ({
      resolveSecret: getResolveSecret(),
      storeSecret: getStoreSecret(),
      bindSecret: getBindSecret(),
    }),
  )
  environmentsByRoot.set(root, service)
  return service
}
