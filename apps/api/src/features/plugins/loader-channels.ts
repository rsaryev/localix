import { errorMessage } from '../../lib/errors'
import { localixWorkspaceDir } from '../../lib/env'
import { buildPluginCatalog } from './catalog'
import type { AvailabilityReader } from '../capabilities/availability'
import { resolvePluginConfig } from './config'
import { pluginLoadBlockReason } from './loadable'
import { makeContext, importNativeModule } from './native'
import { miniAppProblemReporter } from './problem-reporter'
import type { MiniAppChannel, MiniAppContext } from './native'
import { type CapabilitySourceRepository, scalarConfig } from '../capabilities/source-repository'

/**
 * CHANNEL load: the enabled plugins' long-running channels, each bound to its context.
 *
 * Channels come out of `register()`, so unlike monitors and CC hooks (see
 * `loader-declarative.ts`) this cannot avoid importing plugin code. What it avoids is
 * everything else the full loader assembles for a caller that wants one field: every
 * plugin's SKILL.md files read off disk (103 of them on a stock install), MCP records,
 * agents, prompt sections, LSP configs and the per-plugin substituter. The channel host
 * runs this at boot AND on every plugin toggle, and it wanted `channels`.
 *
 * Failure isolation matches the full loader: a plugin whose module throws contributes
 * nothing and never fails the load. So does the trust gate — a disabled plugin's code is
 * not imported, and neither is one this host refuses to run.
 */
export async function loadEnabledMiniAppChannels(opts: {
  repo: CapabilitySourceRepository
  /** What the scope's rules say; a trust gate decides whatever they do not. */
  availability: AvailabilityReader
  userId: string
  projectId?: string
  cwd?: string
  /** The user's home (see `discoverPlugins`). */
  homeDir: string
  logger?: { warn: (msg: string, meta?: unknown) => void }
}): Promise<Array<{ pluginName: string; channel: MiniAppChannel; ctx: MiniAppContext }>> {
  const cwd = opts.cwd ?? localixWorkspaceDir()
  const catalog = await buildPluginCatalog({
    repo: opts.repo,
    availability: opts.availability,
    userId: opts.userId,
    projectId: opts.projectId ?? '',
    cwd,
    homeDir: opts.homeDir,
  })

  const found: Array<{ pluginName: string; channel: MiniAppChannel; ctx: MiniAppContext }> = []
  for (const { plugin, state } of catalog.enabled) {
    if (pluginLoadBlockReason(plugin)) continue
    const config = resolvePluginConfig(plugin.manifest, scalarConfig(state?.config))
    const ctx = makeContext(
      plugin.manifest.name,
      plugin.dir,
      config,
      (message: string) => opts.logger?.warn(`[plugin:${plugin.manifest.name}] ${message}`),
      cwd,
      opts.userId,
      opts.homeDir,
      undefined,
      // A channel runs code for as long as the process does; it may report a problem too.
      miniAppProblemReporter(opts.userId),
    )
    for (const entry of plugin.entrypoints.toolEntries) {
      try {
        const { channels } = await importNativeModule(entry, ctx)
        for (const channel of channels) {
          found.push({ pluginName: plugin.manifest.name, channel, ctx })
        }
      } catch (err) {
        opts.logger?.warn(
          `plugin "${plugin.manifest.name}" failed to load channels from ${entry}`,
          {
            error: errorMessage(err),
          },
        )
      }
    }
  }
  return found
}
