import type { MiddlewareHandler } from 'hono'
import type { HostRouteContext } from '@localixai/mini-app-sdk/backend'
import type { Logger } from './logger'
import { requestQueryKeys, resolveRequestUserId } from './request-identity'
import { assignRequestId, logCompletedRequest, stampRequestId } from './request-id'

/** Identity and request logging run once for every route, after the origin boundary. */
export function createRequestBoundary(
  defaultUserId: string,
  logger: Logger,
): MiddlewareHandler<HostRouteContext> {
  return async (c, next) => {
    // Sanitize the self-asserted identity at the ONE boundary (see request-identity.ts):
    // a blank/whitespace `x-user-id:` must NOT become `''`, which downstream `if (!userId)`
    // guards mistake for the trusted-internal caller and use to bypass ownership.
    c.set('userId', resolveRequestUserId(c.req.header('x-user-id'), defaultUserId))
    const requestId = assignRequestId(c)
    const startedAt = Date.now()
    await next()
    stampRequestId(c, requestId)
    // Query KEYS, never values. `c.req.path` alone hid a real defect for months: a
    // capability snapshot read in the global scope and one read in a project's scope
    // log identically, and they return materially different answers (4 of 19 plugins
    // enabled versus 13 of 17 — git a7f4989a3). Keys settle that, because an unscoped
    // read simply has no `projectId`. Values must stay out: this same server's OAuth
    // callback is handed `?code=&state=`, so logging them would write authorization
    // codes into `~/.localix/logs/api.log`.
    const queryKeys = requestQueryKeys(c.req.query())
    await logCompletedRequest(c, logger, {
      method: c.req.method,
      path: c.req.path,
      ...(queryKeys ? { queryKeys } : {}),
      status: c.res.status,
      durationMs: Date.now() - startedAt,
      requestId,
    })
  }
}
