import type { Context, Env, Input } from 'hono'
import type { KubeErrorResponse } from './contracts'
import { routeValidator } from '@localixai/mini-app-sdk/backend'
import { createKubeConfig } from './api-internals'
import { KubeError, mapKubeError, toErrorInfo } from './errors'
import { localClusterPrerequisite } from './local-cluster'

/**
 * The per-route error funnel for `routes.ts` — one place that serializes a thrown
 * kube error into the typed `{ error, code, detail }` body with the right HTTP
 * status, so the mapping can never drift between endpoints.
 */

/** Serialize any thrown value into the typed `{ error, code, detail }` body. */
export function kubeErrorBody(err: unknown): KubeErrorResponse {
  const info = toErrorInfo(err instanceof KubeError ? err : mapKubeError(err))
  return {
    error: info.message,
    code: info.code,
    detail: info.detail,
    ...(info.prerequisite ? { prerequisite: info.prerequisite } : {}),
  }
}

/**
 * An unreachable LOCAL cluster is a stopped engine: name it, with its start command, so the pane
 * offers "Start Docker Desktop" instead of a Retry that cannot help. The context is the request's
 * `?context=`, or the kubeconfig's current one when the request did not pick.
 */
async function withLocalEngine(
  err: KubeError,
  requestedContext: string | undefined,
): Promise<KubeError> {
  if (err.code !== 'context_unreachable' || err.prerequisite) return err
  const context =
    requestedContext ||
    (await createKubeConfig()
      .then((config) => config.getCurrentContext())
      .catch(() => ''))
  const prerequisite = localClusterPrerequisite(context, process.platform)
  if (!prerequisite) return err
  return new KubeError('context_unreachable', err.message, { cause: err.cause, prerequisite })
}

/** HTTP status for a kube error — setup/auth/connectivity failures are a clean 503,
 * RBAC is 403, a missing resource is 404, and invalid requests remain 400. */
export function statusFor(err: unknown): 400 | 403 | 404 | 503 {
  const mapped = err instanceof KubeError ? err : mapKubeError(err)
  if (
    mapped.code === 'no_kubeconfig' ||
    mapped.code === 'authentication_failed' ||
    mapped.code === 'certificate_error' ||
    mapped.code === 'command_timeout' ||
    mapped.code === 'context_unreachable' ||
    mapped.code === 'tool_missing'
  ) {
    return 503
  }
  if (mapped.code === 'not_found') return 404
  if (mapped.code === 'permission_denied') return 403
  return 400
}

/** Run a handler body and serialize its result — or a thrown kube error — as JSON.
 *  Every route funnels through this so the typed error body + status mapping can
 *  never drift between endpoints. Generic over the route's own env / path / input so each
 *  call site keeps its real context type rather than widening it away. */
export async function guarded<E extends Env, P extends string, I extends Input>(
  c: Context<E, P, I>,
  fn: () => unknown,
): Promise<Response> {
  try {
    return c.json(await fn())
  } catch (err) {
    const mapped = await withLocalEngine(
      err instanceof KubeError ? err : mapKubeError(err),
      c.req.query('context'),
    )
    return c.json(kubeErrorBody(mapped), statusFor(mapped))
  }
}

export const OK = { ok: true as const }

/**
 * The request validator — use this, never a bare one.
 *
 * A validation failure never reaches {@link guarded} (the validator answers rather than throwing),
 * so its body is decided here: the `{ error, code, detail }` contract this file exists to enforce,
 * via the SDK's validator in its `flat` envelope. The workbench client (`kubernetesApi.readOr`)
 * reads `error` as a string — handed an object it built `new KubeApiError(object)`, whose message
 * was the literal text `[object Object]`.
 */
export const validated = routeValidator({
  envelope: 'flat',
  code: 'invalid_request' satisfies KubeErrorResponse['code'],
})
