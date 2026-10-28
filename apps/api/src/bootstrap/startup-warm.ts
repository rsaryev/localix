import { resolveDefaultUserId } from '../lib/env'
import type { InfraPhase } from './infra'
import type { DomainServicesPhase } from './domain-services'

/**
 * Pay for plugin discovery before a client has to.
 *
 * `GET /rpc/capabilities/snapshot` and `GET /rpc/tools/gc` both resolve plugin
 * contributions, and the first caller after boot funds the content-hash of the whole
 * plugin directory. Measured on a packaged launch that is ~1.2s, and the client pays it
 * — it is the single largest span between the workspace appearing and the activity rail
 * being complete, and it lands as a visible fill-in.
 *
 * Called AFTER the server is listening, never before: moving it ahead of readiness would
 * just relabel the same second as startup time and delay the window. Failures are
 * irrelevant here — this is a cache warm, and the real request will surface any problem
 * with its own error handling.
 */
export function createStartupWarm({
  logger,
  pluginService,
  miniAppService,
}: Pick<InfraPhase, 'logger'> &
  Pick<DomainServicesPhase, 'pluginService' | 'miniAppService'>): () => void {
  return (): void => {
    const userId = resolveDefaultUserId()
    void pluginService
      .listPlugins(userId, { projectId: null })
      .then((result) => logger.debug({ event: 'startup.warm', plugins: result.plugins.length }))
      .catch(() => {})
    void miniAppService
      .list(userId, { projectId: null })
      .then((result) => logger.debug({ event: 'startup.warm', miniApps: result.miniApps.length }))
      .catch(() => {})
  }
}
