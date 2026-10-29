import { errorMessage } from '../../lib/errors'
import { localixWorkspaceDir } from '../../lib/env'
import { buildMiniAppCatalog } from './catalog'
import type { AvailabilityReader } from '../capabilities/availability'
import { resolveMiniAppConfig } from './config'
import { miniAppLoadBlockReason } from './loadable'
import { importNativeModule } from './native'
import { makeContext } from './native-context'
import { miniAppProblemReporter } from './problem-reporter'
import type { MiniAppChannel, MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { type CapabilitySourceRepository, scalarConfig } from '../capabilities/source-repository'

/**
 * CHANNEL load: the enabled mini apps' long-running channels, each bound to its context. The
 * channel host runs this at boot and on every enable and disable, and wants only `channels`, so
 * nothing else the full load assembles is built.
 *
 * Failure isolation matches the full load: an app whose module throws contributes nothing and
 * never fails the load, and an app that may not run is never imported.
 */
export async function loadEnabledMiniAppChannels(opts: {
  repo: CapabilitySourceRepository
  /** What the scope's rules say; a trust gate decides whatever they do not. */
  availability: AvailabilityReader
  userId: string
  projectId?: string
  cwd?: string
  homeDir: string
  logger?: { warn: (msg: string, meta?: unknown) => void }
}): Promise<Array<{ app: string; channel: MiniAppChannel; ctx: MiniAppContext }>> {
  const cwd = opts.cwd ?? localixWorkspaceDir()
  const catalog = await buildMiniAppCatalog({
    repo: opts.repo,
    availability: opts.availability,
    userId: opts.userId,
    projectId: opts.projectId ?? '',
    cwd,
    homeDir: opts.homeDir,
  })

  const found: Array<{ app: string; channel: MiniAppChannel; ctx: MiniAppContext }> = []
  for (const { app, state } of catalog.enabled) {
    if (miniAppLoadBlockReason(app) || !app.manifest) continue
    const config = resolveMiniAppConfig(app.manifest.config, scalarConfig(state?.config))
    const ctx = makeContext(
      app.name,
      app.dir,
      config,
      (message: string) => opts.logger?.warn(`[mini-app:${app.name}] ${message}`),
      cwd,
      opts.userId,
      opts.homeDir,
      undefined,
      // A channel runs code for as long as the process does; it may report a problem too.
      miniAppProblemReporter(opts.userId),
    )
    for (const entry of app.backendEntries) {
      try {
        const { channels } = await importNativeModule(entry, ctx)
        for (const channel of channels) found.push({ app: app.name, channel, ctx })
      } catch (err) {
        opts.logger?.warn(`mini app "${app.name}" failed to load channels from ${entry}`, {
          error: errorMessage(err),
        })
      }
    }
  }
  return found
}
