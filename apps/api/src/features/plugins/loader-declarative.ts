import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { localixWorkspaceDir } from '../../lib/env'
import { buildPluginCatalog } from './catalog'
import type { AvailabilityReader } from '../capabilities/availability'
import { dataDirOfPlugin } from './plugin-data-id'
import { scalarConfig, type CapabilitySourceRepository } from '../capabilities/source-repository'
import { resolvePluginConfig } from './config'
import { catalogRun } from './catalog-kit'
import type { LocalixPluginHost, ManagedSettingsSource } from './kit'

/**
 * Contributions that are pure MANIFEST DATA — collected without importing a single
 * line of plugin code.
 *
 * `loadEnabledPlugins` is the full pipeline: it imports every enabled plugin's native
 * entrypoint and calls `register(ctx)` to collect tools, hooks, channels and backends.
 * That is the right price for a caller that needs those. It is the wrong price for a
 * caller that needs only what discovery already parsed out of `plugin.json` (the mods host).
 *
 * Which plugins run is the same verdict as in the full loader, the kit's (`catalogRun`): the
 * agent's selection, managed settings over it, and the plugins' dependencies; a plugin the host
 * refuses to load contributes nothing either.
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
  /** The plugin host the scope's session opens on: which plugins run is the kit's to judge. */
  pluginHost: LocalixPluginHost
  /** The managed settings that may turn a plugin on or off; the machine's own by default. */
  managed?: ManagedSettingsSource | null
}

/** An enabled plugin's hooks module, as the mods host loads it. */
export interface LoadedPluginMod {
  plugin: string
  root: string
  /** The version it loaded at (`ModSource.version`). */
  version?: string
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
  const run = await catalogRun(opts.pluginHost, catalog, {
    cwd: opts.cwd ?? localixWorkspaceDir(),
    homeDir: opts.homeDir,
    ...(opts.managed === undefined ? {} : { managed: opts.managed }),
  })
  const mods: LoadedPluginMod[] = []
  for (const { plugin, state, error } of run.entries) {
    const module = plugin.entrypoints.hookModule
    if (!module || error) continue
    const options = resolvePluginConfig(plugin.manifest, scalarConfig(state?.config))
    mods.push({
      plugin: plugin.manifest.name,
      root: plugin.dir,
      ...(plugin.manifest.version ? { version: plugin.manifest.version } : {}),
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

/**
 * The newest modification time under `dir`: a hooks module and the files it imports. A link is read
 * and never entered: a recursive `readdir` follows one, and a link back to its own folder never ends.
 */
async function newestChange(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const times = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      const own = await stat(path).then(
        (info) => info.mtimeMs,
        () => 0,
      )
      return entry.isDirectory() ? Math.max(own, await newestChange(path)) : own
    }),
  )
  return Math.max(0, ...times)
}
