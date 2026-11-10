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

/**
 * A plugin the catalog loaded: its `name@marketplace` id and the folder it was read from. Whether
 * it runs is each session's settings' to say (`./sessions`), never the host's.
 */
export interface LoadedKitPlugin {
  readonly id: string
  /** The folder `loadPlugin` read: `${CLAUDE_PLUGIN_ROOT}`, where its command hooks run. */
  readonly root: string
  readonly plugin: Plugin
}

export interface LocalixPluginHost {
  /** The kit host itself, for the boundary's own modules (sessions, the catalog). */
  readonly kit: PluginHost
  readonly ports: LocalixKitPorts
  /** Replaces every plugin the host holds; open sessions read the new set at their next use. */
  setPlugins(plugins: readonly LoadedKitPlugin[]): void
  /**
   * The plugins one scope's catalog found (a project and folder): the host holds those of every
   * scope a run has read, the first of an id kept, and changes only when a scope's set does.
   */
  feedScope(scope: string, plugins: readonly LoadedKitPlugin[]): void
  /** Every plugin the host was given, with whether it runs. */
  plugins(): readonly HostedPlugin[]
  /** One more each time the plugins change: a holder of the number sees the change. */
  readonly generation: number
}

const sameSet = (held: readonly LoadedKitPlugin[] | undefined, given: readonly LoadedKitPlugin[]) =>
  held?.length === given.length &&
  held.every(
    (one, at) =>
      one.id === given[at]?.id && one.root === given[at]?.root && one.plugin === given[at]?.plugin,
  )

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
    // A project's portable `.agents/skills` beside its `.claude` ones (`agent-core/skill-scan.ts`).
    extraScopeFolders: ['.agents'],
  })
  const scopes = new Map<string, readonly LoadedKitPlugin[]>()
  const setPlugins = (plugins: readonly LoadedKitPlugin[]) => {
    roots = new Map(plugins.map((entry) => [entry.id, entry.root]))
    kit.update({ plugins: plugins.map(({ id, plugin }) => ({ id, plugin })) })
  }
  return {
    kit,
    ports,
    setPlugins,
    feedScope(scope, plugins) {
      if (sameSet(scopes.get(scope), plugins)) return
      scopes.set(scope, plugins)
      const byId = new Map<string, LoadedKitPlugin>()
      for (const entry of [...scopes.values()].flat())
        if (!byId.has(entry.id)) byId.set(entry.id, entry)
      setPlugins([...byId.values()])
    },
    plugins: () => kit.plugins,
    get generation() {
      return kit.generation
    },
  }
}
