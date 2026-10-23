import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { routeValidator, summarizeZodIssues } from '@localixai/mini-app-sdk/backend'
import type { MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import type { DockerErrorResponse } from './contracts'
import { logsQuerySchema, pruneTargetSchema, removeQuerySchema } from './contracts'
import { DockerError, mapDockerError, toErrorInfo } from './errors'
import type { DockerService } from './service'

/** Serialize any thrown value into the typed `{ error, code, detail }` body. */
function dockerErrorBody(err: unknown): DockerErrorResponse {
  const info = toErrorInfo(err instanceof DockerError ? err : mapDockerError(err))
  return {
    error: info.message,
    code: info.code,
    detail: info.detail,
    ...(info.prerequisite ? { prerequisite: info.prerequisite } : {}),
  }
}

/** HTTP status for a docker error — a missing engine is a clean 503 the UI turns
 *  into an empty state, a bad container id a 404, everything else a 400. */
function statusFor(err: unknown): 400 | 404 | 503 {
  const mapped = err instanceof DockerError ? err : mapDockerError(err)
  if (mapped.code === 'engine_unavailable') return 503
  if (mapped.code === 'not_found') return 404
  return 400
}

/** Run a service call and serialize its result — or its typed docker error — as
 *  JSON. Every route shares this one success/error shape. */
async function jsonOr<T>(c: Context, fn: () => Promise<T>): Promise<Response> {
  try {
    return c.json(await fn())
  } catch (err) {
    return c.json(dockerErrorBody(err), statusFor(err))
  }
}

/**
 * A rejected request answers in the typed `DockerErrorResponse` body (`{ error, code, detail }`)
 * every other failure here uses — the SDK's validator in its `flat` envelope. A validation
 * failure never reaches `onError` (the validator answers rather than throwing), so this is the
 * one place its body is decided.
 */
const validated = routeValidator({
  envelope: 'flat',
  code: 'invalid_request' satisfies DockerErrorResponse['code'],
})

/** `jsonOr` for action routes whose success body is the bare `{ ok: true }`. */
const okOr = (c: Context, fn: () => Promise<void>): Promise<Response> =>
  jsonOr(c, async () => {
    await fn()
    return { ok: true as const }
  })

/**
 * Docker workbench backend — list containers/images/volumes/networks, tail logs,
 * and run start/stop/restart/remove/prune. The container engine is a single
 * host-wide daemon, so there is no per-user connection registry (unlike the
 * database workbench). A missing/stopped daemon surfaces as a typed 503 the
 * sidebar renders as an empty state rather than an error toast.
 */
export function createDockerRoutes(service: DockerService) {
  const app = new Hono<MiniAppRouteContext>()

  const routes = app
    .get('/containers', (c) =>
      jsonOr(c, async () => ({ containers: await service.listContainers() })),
    )
    .get('/images', (c) => jsonOr(c, async () => ({ images: await service.listImages() })))
    .get('/volumes', (c) => jsonOr(c, async () => ({ volumes: await service.listVolumes() })))
    .get('/networks', (c) => jsonOr(c, async () => ({ networks: await service.listNetworks() })))
    .get('/containers/:id/logs', validated('query', logsQuerySchema), (c) => {
      const { tail, sinceSeconds } = c.req.valid('query')
      return jsonOr(c, () => service.containerLogs(c.req.param('id'), tail ?? 200, sinceSeconds))
    })
    .get('/containers/:id/stats', (c) =>
      jsonOr(c, async () => ({ stats: await service.containerStats(c.req.param('id')) })),
    )
    .get('/containers/:id/top', (c) => jsonOr(c, () => service.containerTop(c.req.param('id'))))
    .post('/containers/:id/start', (c) => okOr(c, () => service.startContainer(c.req.param('id'))))
    .post('/containers/:id/stop', (c) => okOr(c, () => service.stopContainer(c.req.param('id'))))
    .post('/containers/:id/restart', (c) =>
      okOr(c, () => service.restartContainer(c.req.param('id'))),
    )
    .post('/containers/:id/remove', validated('query', removeQuerySchema), (c) => {
      const force = c.req.valid('query').force ?? false
      return okOr(c, () => service.removeContainer(c.req.param('id'), force))
    })
    .delete('/images/:id', validated('query', removeQuerySchema), (c) => {
      const force = c.req.valid('query').force ?? false
      return okOr(c, () => service.removeImage(c.req.param('id'), force))
    })
    .post('/volumes/:name/remove', validated('query', removeQuerySchema), (c) => {
      const force = c.req.valid('query').force ?? false
      return okOr(c, () => service.removeVolume(c.req.param('name'), force))
    })
    .post('/networks/:id/remove', (c) => okOr(c, () => service.removeNetwork(c.req.param('id'))))
    .post('/prune', validated('json', z.object({ target: pruneTargetSchema })), (c) =>
      jsonOr(c, () => service.prune(c.req.valid('json').target)),
    )
    .get('/compose/available', (c) =>
      jsonOr(c, async () => ({ available: await service.composeAvailable() })),
    )
    .post('/compose/:project/up', (c) => okOr(c, () => service.composeUp(c.req.param('project'))))

  // Self-contained fallback for a THROWN error. A validation failure never arrives here — it
  // returns a response rather than throwing, which is why `validated()` above exists; what does
  // arrive is a `.parse()` inside a handler. Anything else is serialized through the same typed
  // docker error body the per-route jsonOr/okOr wrappers use (missing daemon → 503, bad id → 404,
  // else 400).
  routes.onError((error, c) => {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: summarizeZodIssues(error).headline,
          code: 'invalid_request',
          detail: summarizeZodIssues(error).detail,
        } satisfies DockerErrorResponse,
        400,
      )
    }
    return c.json(dockerErrorBody(error), statusFor(error))
  })
  return routes
}
