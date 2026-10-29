import { Hono } from 'hono'
import {
  LOCALIX_API_PRODUCT_ID,
  LOCALIX_API_PROTOCOL_VERSION,
  type LocalixRuntimeInfo,
} from './lib/runtime-protocol'
import { localixVersion } from './lib/app-version'
import { MINI_APP_CONTRACT } from './lib/mini-app-contract'

/**
 * Liveness probe — DEPENDENCY-FREE BY DESIGN.
 *
 * It lives in its own module (importing nothing but Hono) so that being dep-free is a
 * structural fact rather than a claim: `createApp` needs 30+ services, and requiring
 * all of them just to prove a constant 200 forced its own test to fabricate an AppDeps
 * it could not actually build.
 *
 * Consumed by server-readiness polls over an UNTYPED fetch — the runtime-endpoint probe
 * (`lib/runtime-endpoint.ts`) and the dev supervisors (`scripts/dev-api.mjs`,
 * `scripts/dev-servers.mjs`) — so it is deliberately NOT part of the exported Hono RPC
 * `App` type, same as the subsystem route mounts.
 */
export function createHealthRoutes(
  info?: Pick<LocalixRuntimeInfo, 'instanceId' | 'startedAt' | 'databaseId' | 'version'> & {
    /**
     * True once shutdown has begun. A reopen right after quit found the dying runtime still
     * answering 200 here and attached to it; the socket closed a second later and the new
     * window was left talking to nothing. 503 makes every liveness probe (`response.ok`)
     * read "not attachable" for the whole drain.
     */
    isDraining?: () => boolean
  },
) {
  return new Hono().get('/health', (c) => {
    const draining = info?.isDraining?.() === true
    const version = info?.version ?? localixVersion()
    return c.json(
      {
        status: draining ? 'draining' : 'ok',
        productId: LOCALIX_API_PRODUCT_ID,
        instanceId: info?.instanceId ?? 'unpublished',
        protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
        startedAt: info?.startedAt ?? 'unknown',
        ...(info?.databaseId ? { databaseId: info.databaseId } : {}),
        ...(version ? { version } : {}),
        miniAppContract: MINI_APP_CONTRACT,
      } satisfies LocalixRuntimeInfo,
      draining ? 503 : 200,
    )
  })
}
