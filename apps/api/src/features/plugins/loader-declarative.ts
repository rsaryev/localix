import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { localixWorkspaceDir } from '../../lib/env'
import { buildPluginCatalog } from './catalog'
import type { AvailabilityReader } from '../capabilities/availability'
import { pluginLoadBlockReason } from './load-block'
import { dataDirOfPlugin } from './plugin-data-id'
import { scalarConfig, type CapabilitySourceRepository } from '../capabilities/source-repository'
import { resolvePluginConfig } from './config'

/**
 * Contributions that are pure MANIFEST DATA — collected without importing a single
 * line of plugin code.
 *
 * `loadEnabledPlugins` is the full pipeline: it imports every enabled plugin's native
 * entrypoint and calls `register(ctx)` to collect tools, hooks, channels and backends.
 * That is the right price for a caller that needs those. It is the wrong price for a
 * caller that needs only what discovery already parsed out of `plugin.json` (the mods host).
 *
 * The enable state remains the trust gate here exactly as in the full loader: a
 * disabled plugin contributes nothing, and a plugin the host refuses to load
 * (`pluginLoadBlockReason`) contributes nothing either.
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

/** An enabled plugin's hooks module, as the mods host loads it. */
export interface LoadedPluginMod {
  plugin: string
  root: string
  module: string
  /** Its `userConfig` values, defaults filled in (`register`'s `options`). */
  options: Record<string, unknown>
  /** Changes when a file beside the module (its own imports), its types file or the options change (`modRevision`). */
  revision: string
  /** Its `${CLAUDE_PLUGIN_DATA}`, keyed by the plugin's identifier. */
  dataDir: string
}

/**
 * The enabled plugins that are mods, read from discovery without importing plugin code: the mods host builds and imports each module itself.
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
    mods.push({
      plugin: plugin.manifest.name,
      root: plugin.dir,
      dataDir: dataDirOfPlugin(plugin, opts.homeDir),
      module,
      options,
      revision: await modRevision({ module, types: plugin.entrypoints.hookTypes }, options),
    })
  }
  return mods
}

/**
 * What identifies one load of a mod: the newest change beside its module (its own imports), its
 * types file (the loader checks the module's `$.state` against it), and its options. The mods
 * host reloads a mod only when this changes.
 */
export async function modRevision(
  files: { module: string; types?: string | undefined },
  options: Record<string, unknown>,
): Promise<string> {
  const types = files.types
    ? await stat(files.types).then(
        (info) => info.mtimeMs,
        () => 0,
      )
    : 0
  const code = await newestChange(dirname(files.module))
  return `${code}:${files.types ?? ''}:${types}:${JSON.stringify(options)}`
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
