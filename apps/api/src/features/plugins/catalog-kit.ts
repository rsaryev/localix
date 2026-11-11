import { scalarConfig } from '../capabilities/source-repository'
import type { PluginCatalog } from './catalog'
import { storedOptionValues } from './config'
import {
  scopeRun,
  type LocalixPluginHost,
  type ManagedSettingsSource,
  type ScopePlugin,
} from './kit'
import { pluginLoadBlockReason } from './load-block'
import { pluginIdOf } from './plugin-data-id'

/**
 * Every plugin of a scope's catalog as the kit takes it: its id and folder, whether the scope's
 * agent may use it, a user install (the host's) or the project's own (the session's), and the
 * values saved for it.
 */
export function kitPluginsOf(catalog: Pick<PluginCatalog, 'all'>): ScopePlugin[] {
  return catalog.all.flatMap(({ plugin, state, enabled }) =>
    plugin.kit
      ? [
          {
            id: pluginIdOf(plugin),
            root: plugin.dir,
            plugin: plugin.kit,
            selected: enabled && !pluginLoadBlockReason(plugin),
            scope: plugin.scope === 'project' ? 'project' : 'user',
            values: storedOptionValues(plugin.manifest, scalarConfig(state?.config)),
          } as const,
        ]
      : [],
  )
}

/** The folder, home and managed settings a catalog's scope is judged in (`PluginScope`). */
export interface CatalogScope {
  readonly cwd: string
  readonly homeDir: string
  /** The managed settings; the machine's own by default, `null` for none. */
  readonly managed?: ManagedSettingsSource | null
}

/**
 * The kit's verdict on a catalog (`scopeRun`), what every loader starts plugin code by: the entries
 * the scope turns on, each with what keeps it off (`error`: a refusal of this host,
 * `pluginLoadBlockReason`, or the kit's, a dependency not met), the kit's errors by `pluginIdOf`,
 * and the running plugins' MCP servers. An entry runs when it has no `error`.
 */
export async function catalogRun(
  host: LocalixPluginHost,
  catalog: Pick<PluginCatalog, 'all'>,
  scope: CatalogScope,
) {
  const { running, errors, mcpServers } = await scopeRun(host, {
    ...scope,
    plugins: kitPluginsOf(catalog),
  })
  const entries = catalog.all.flatMap((entry) => {
    const id = pluginIdOf(entry.plugin)
    const error = pluginLoadBlockReason(entry.plugin) ?? errors.get(id)
    const on = running.has(id) || (error !== undefined && (entry.enabled || errors.has(id)))
    return on ? [{ ...entry, ...(error === undefined ? {} : { error }) }] : []
  })
  return { entries, errors, mcpServers }
}

/**
 * The kit's error against each plugin of a catalog, by `pluginIdOf` (a dependency not installed,
 * disabled or outside its range keeps the plugin off): what its record shows. None without a host.
 */
export async function catalogPluginErrors(
  host: LocalixPluginHost | undefined,
  catalog: Pick<PluginCatalog, 'all'>,
  scope: CatalogScope,
): Promise<ReadonlyMap<string, string>> {
  return host ? (await catalogRun(host, catalog, scope)).errors : new Map()
}
