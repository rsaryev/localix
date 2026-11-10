import {
  createPluginHost,
  type HostedPlugin,
  type Plugin,
  type PluginHost,
} from '@rsaryev/llx-plugin'
import { createHostPorts, type HostPortsDeps, type LocalixKitPorts } from './ports/host-ports'

/**
 * The one plugin host of the app process (`createPluginHost`), built from Localix's ports. Bootstrap
 * makes it where it makes the plugin services; the engines that come up later (MCP clients, the
 * models) are read through the getters of `deps` at call time. The plugins come from the catalog
 * (`./catalog`), which loads each folder and gives the host the result with `setPlugins`.
 */
export type PluginHostDeps = Omit<HostPortsDeps, 'pluginRoot' | 'projectDir'>

/** A plugin the catalog loaded: its `name@marketplace` id, the folder it was read from, and its state. */
export interface LoadedKitPlugin {
  readonly id: string
  /** The folder `loadPlugin` read: `${CLAUDE_PLUGIN_ROOT}`, where its command hooks run. */
  readonly root: string
  readonly plugin: Plugin
  /** What Localix's rules decided (`capability_rule`, trust): the host runs only these. */
  readonly enabled: boolean
}

export interface LocalixPluginHost {
  /** The kit host itself, for the boundary's own modules (sessions, the catalog). */
  readonly kit: PluginHost
  readonly ports: LocalixKitPorts
  /** Replaces every plugin the host holds; open sessions read the new set at their next use. */
  setPlugins(plugins: readonly LoadedKitPlugin[]): void
  /** Every plugin the host was given, with whether it runs. */
  plugins(): readonly HostedPlugin[]
  /** One more each time the plugins change: a holder of the number sees the change. */
  readonly generation: number
}

export function createLocalixPluginHost(deps: PluginHostDeps): LocalixPluginHost {
  let roots = new Map<string, string>()
  const ports = createHostPorts({
    ...deps,
    // A session binds its own project (`hookPorts.locations`); the host's is the home folder.
    projectDir: () => deps.homeDir,
    pluginRoot: (id) => roots.get(id) ?? '',
  })
  const kit = createPluginHost({
    plugins: [],
    ports: ports.host,
    envFiles: ports.envFiles,
    // Localix builds the launch environment of every process (`childEnv`).
    launchOwnsEnvironment: true,
  })
  return {
    kit,
    ports,
    setPlugins(plugins) {
      roots = new Map(plugins.map((entry) => [entry.id, entry.root]))
      kit.update({
        plugins: plugins.map(({ id, plugin, enabled }) => ({ id, plugin, enabled })),
      })
    },
    plugins: () => kit.plugins,
    get generation() {
      return kit.generation
    },
  }
}
