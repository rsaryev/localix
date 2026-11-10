import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
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
 * (`./catalog`): the host holds the user-scope installs (`setUserPlugins`), and each session brings
 * its project's own (`./sessions`).
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
  /**
   * The user-scope installs one catalog read. A held one whose id this catalog's project installs
   * hide (`masked`) stays: another project's sessions still run it. Changes only when the set does.
   */
  setUserPlugins(plugins: readonly LoadedKitPlugin[], masked?: ReadonlySet<string>): void
  /**
   * Runs `call` with the locations of one session: its project and its own plugins' folders. The
   * kit resolves a session's components through the host's locations (`host/scope.ts`).
   */
  within<T>(place: SessionPlace, call: () => Promise<T>): Promise<T>
  /** Every plugin the host was given, with whether it runs. */
  plugins(): readonly HostedPlugin[]
  /** One more each time the plugins change: a holder of the number sees the change. */
  readonly generation: number
}

/** Where one session runs: its project folder and the folder of each of its own plugins. */
export interface SessionPlace {
  readonly projectDir: string
  readonly roots: ReadonlyMap<string, string>
}

const sameEntry = (one: LoadedKitPlugin, other: LoadedKitPlugin) =>
  one.id === other.id && one.root === other.root && isDeepStrictEqual(one.plugin, other.plugin)

/** `given`, each entry the same as a held one replaced by the held object: a re-read keeps identity. */
export function keepUnchanged(
  held: readonly LoadedKitPlugin[],
  given: readonly LoadedKitPlugin[],
): readonly LoadedKitPlugin[] {
  return given.map((entry) => held.find((one) => sameEntry(one, entry)) ?? entry)
}

export const samePlugins = (a: readonly LoadedKitPlugin[], b: readonly LoadedKitPlugin[]) =>
  a.length === b.length && a.every((one, at) => one === b[at])

export function createLocalixPluginHost(deps: PluginHostDeps): LocalixPluginHost {
  let held: readonly LoadedKitPlugin[] = []
  let roots = new Map<string, string>()
  const place = new AsyncLocalStorage<SessionPlace>()
  const ports = createHostPorts({
    ...deps,
    // Outside a session's place, the host's project is the home folder.
    projectDir: () => place.getStore()?.projectDir ?? deps.homeDir,
    pluginRoot: (id) => place.getStore()?.roots.get(id) ?? roots.get(id) ?? '',
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
  return {
    kit,
    ports,
    setUserPlugins(plugins, masked = new Set()) {
      const kept = held.filter(
        (one) => masked.has(one.id) && !plugins.some((entry) => entry.id === one.id),
      )
      const next = keepUnchanged(held, [...plugins, ...kept])
      if (samePlugins(held, next)) return
      held = next
      roots = new Map(next.map((entry) => [entry.id, entry.root]))
      kit.update({ plugins: next.map(({ id, plugin }) => ({ id, plugin })) })
    },
    within: (where, call) => place.run(where, call),
    plugins: () => kit.plugins,
    get generation() {
      return kit.generation
    },
  }
}
