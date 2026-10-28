import type { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { MiniAppRouteScope } from '@localixai/mini-app-sdk/backend'

import type { MiniAppBackendHostDeps } from './backend-host-contracts'

/**
 * The ONE stable dispatcher middleware: Hono cannot unmount a route, so it reads the host's live
 * mount table per request and hands a request under a mounted prefix to that mini app's app.
 */
export function createMountDispatcher(
  mounts: ReadonlyMap<string, Hono>,
  deps: Pick<MiniAppBackendHostDeps, 'resolveScope' | 'logger'>,
): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path
    for (const [prefix, wrapper] of mounts) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        // The raw request loses the parent context, which is why a mini app route cannot read
        // `c.get('userId')`. Hono's second `fetch` argument IS the mounted app's `c.env`, so
        // the resolved scope travels there instead of being re-derived by every mini app from
        // the host's own env module (which is how that boundary got crossed in the first
        // place). Resolution failures degrade to no environment rather than a 500: a mini app
        // route that does not need scope must keep working.
        const userId = c.get('userId') as string | undefined
        let scope: MiniAppRouteScope | undefined
        if (deps.resolveScope && userId) {
          try {
            scope = await deps.resolveScope({ userId, request: c.req.raw })
          } catch (err) {
            deps.logger?.warn('mini app route scope resolution failed', { error: String(err) })
          }
        }
        return wrapper.fetch(c.req.raw, scope)
      }
    }
    return next()
  }
}
