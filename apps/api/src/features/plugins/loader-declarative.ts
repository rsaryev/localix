import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { localixWorkspaceDir } from '../../lib/env'
import { buildPluginCatalog } from './catalog'
import type { AvailabilityReader } from '../capabilities/availability'
import { pluginLoadBlockReason } from './loadable'
import { pluginDataDir } from './mcp'
import type { LoadedPluginMonitor } from './loader'
import { scalarConfig, type CapabilitySourceRepository } from '../capabilities/source-repository'
import { resolvePluginConfig } from './config'

/**
 * Contributions that are pure MANIFEST DATA — collected without importing a single
 * line of plugin code.
 *
 * `loadEnabledPlugins` is the full pipeline: it imports every enabled plugin's native
 * entrypoint and calls `register(ctx)` to collect tools, hooks, channels and backends.
 * That is the right price for a caller that needs those. It is the wrong price for a
 * caller that needs only what discovery already parsed out of `plugin.json` — and the
 * monitor host was paying it, importing ~9 MB of bundled plugin JS and running every
 * `register()` at boot to read a manifest array that, across every bundled plugin,
 * is empty.
 *
 * The enable state remains the trust gate here exactly as in the full loader: a
 * disabled plugin contributes nothing, and a plugin the host refuses to load
 * (`pluginLoadBlockReason`) contributes nothing either — a manifest this host cannot
 * satisfy must not get a monitor spawned on its behalf.
 */

export interface DeclarativeLoadOptions {
  repo: CapabilitySourceRepository
  /** What the scope's rules say; a trust gate decides whatever they do not. */
  availability: AvailabilityReader
  userId: string
  projectId?: string
  cwd?: string
  /** The user's home (see `discoverPlugins`). */
  homeDir: string
}

/**
 * The enabled plugins' declared background monitors, with the roots the monitor host
 * substitutes into each command. Same shape and same order the full loader produces,
 * so the host cannot tell which path built its list.
 */
export async function loadEnabledPluginMonitors(
  opts: DeclarativeLoadOptions,
): Promise<LoadedPluginMonitor[]> {
  const catalog = await buildPluginCatalog({
    repo: opts.repo,
    availability: opts.availability,
    userId: opts.userId,
    projectId: opts.projectId ?? '',
    cwd: opts.cwd ?? localixWorkspaceDir(),
    homeDir: opts.homeDir,
  })

  const monitors: LoadedPluginMonitor[] = []
  for (const { plugin } of catalog.enabled) {
    if (pluginLoadBlockReason(plugin)) continue
    for (const monitor of plugin.entrypoints.monitors) {
      monitors.push({
        pluginName: plugin.manifest.name,
        pluginRoot: plugin.dir,
        dataDir: pluginDataDir(plugin.manifest.name, opts.homeDir),
        monitor,
      })
    }
  }
  return monitors
}

/** An enabled plugin's hooks module, as the mods host loads it. */
export interface LoadedPluginMod {
  plugin: string
  root: string
  module: string
  /** Its `userConfig` values, defaults filled in (`register`'s `options`). */
  options: Record<string, unknown>
  /** Changes when a file beside the module (its own imports) or the options change. */
  revision: string
}

/**
 * The enabled plugins that are mods. Like monitors, read from discovery without importing plugin
 * code: the mods host builds and imports each module itself.
 */
export async function loadEnabledPluginMods(
  opts: DeclarativeLoadOptions,
): Promise<LoadedPluginMod[]> {
  const catalog = await buildPluginCatalog({
    repo: opts.repo,
    availability: opts.availability,
    userId: opts.userId,
    projectId: opts.projectId ?? '',
    cwd: opts.cwd ?? localixWorkspaceDir(),
    homeDir: opts.homeDir,
  })
  const mods: LoadedPluginMod[] = []
  for (const { plugin, state } of catalog.enabled) {
    const module = plugin.entrypoints.hookModule
    if (!module || pluginLoadBlockReason(plugin)) continue
    const options = resolvePluginConfig(plugin.manifest, scalarConfig(state?.config))
    const mtime = await newestChange(dirname(module))
    mods.push({
      plugin: plugin.manifest.name,
      root: plugin.dir,
      module,
      options,
      revision: `${mtime}:${JSON.stringify(options)}`,
    })
  }
  return mods
}

/** The newest modification time under `dir`: a hooks module and the files it imports. */
async function newestChange(dir: string): Promise<number> {
  const files = await readdir(dir, { recursive: true }).catch(() => [] as string[])
  const times = await Promise.all(
    files.map((file) =>
      stat(join(dir, file)).then(
        (info) => info.mtimeMs,
        () => 0,
      ),
    ),
  )
  return Math.max(0, ...times)
}
