import { AsyncLocalStorage } from 'node:async_hooks'
import type { JsonObject } from '@rsaryev/llx-plugin/mods'
import type { ModsHost as KitModsHost, ModCompiler, ModRuntime } from '@rsaryev/llx-plugin/mods'
import {
  createModsHost,
  hostCommandRunner,
  hostLocations,
  readClaudeSettings,
  systemClock,
  type ManagedSettingsSource,
} from '../../plugins/kit'
import type { ModScene, ModSource, ModsPorts } from '../contracts'
import type { ModComposer } from '../composer'
import { createModuleCompiler } from '../module-build'
import type { PaneScreen } from '../panes'
import type { ModVmPort, VmClock } from '../isolation/mod-vm'
import { createVmRuntime } from '../isolation/vm-runtime'
import {
  bunModSpawner,
  diskModFs,
  fetchModFetcher,
  fileModStore,
  sessionModEnv,
} from './platform-ports'
import { createCrashes } from './crashes'
import { createHostKeeping } from './host-keeping'
import {
  disposeOf,
  failuresOf,
  keyOf,
  modPluginOf,
  nameOf,
  processEnv,
  reportLine,
  revisionOf,
  type Live,
  type LiveHost,
} from './live-hosts'
import { createRunTools, type RunSurface } from './run-tools'
import { createSessionInterface } from './session-interface'
import { sessionDeny, sessionPolicy } from './session-policy'
import { createSessionPorts } from './session-ports'

/**
 * One kit `ModsHost` per Localix conversation, as Claude Code runs one mods runtime per session:
 * its chain, its `$` and its interface bound to that conversation's scene. The project a
 * conversation runs in chooses which mods it loads (`ModSource`); each loads in a VM of its own
 * (`vm-runtime.ts`), on the conversation's one thread, as Claude Code runs a session's mods on one.
 * Hosts are kept for the conversations used most recently, the oldest past the
 * limit or unused for `idleMs` going unless in use (`host-keeping.ts`), and a change to the mods it
 * loaded disposes it so the next use loads them anew. The workspace's host stays outside that
 * limit: it holds the commands and panes there before any chat.
 */

/** Conversations' hosts kept at once, the workspace's aside; Localix's mods ran one instance per project for up to this many. */
export const SESSION_HOSTS = 16
/** How long a conversation's host is kept unused. */
export const IDLE_MS = 10 * 60_000

export interface SessionModsDeps {
  ports: ModsPorts
  composer: ModComposer
  /** `$.ui.invalidate(event)`: the event's kept answers go. */
  rerun: (event: string) => void
  vms: ModVmPort
  runtimeDir?: string
  homeDir: string
  /** The names of Localix's own commands. */
  builtIns: () => readonly string[]
  hangMs?: number
  memoryLimitBytes?: number
  maxHosts?: number
  idleMs?: number
  /** The conversation's running turn, while it runs (`$.tool`, `$.mcp`, `$.ui.ask`, `$.agent.spawn`). */
  turnOf?: (scene: ModScene) => RunSurface | undefined
  /** `$.session.compact` and `$.prompt.compose` of the conversation (`event-calls.ts`). */
  compact?: (scene: ModScene) => Promise<JsonObject>
  compose?: (scene: ModScene) => Promise<readonly { id: string; text: string; scope: string }[]>
  /** The managed settings source; the machine's own by default, `null` for none. */
  managed?: ManagedSettingsSource | null
  /** Which panes the screen shows, by host key (`createPaneScreen` of `panes.ts`). */
  screen?: Pick<PaneScreen, 'shownPane' | 'focusedPane'>
  /** How hooks modules compile: one compiler for every host, so a module is built once. */
  compiler?: ModCompiler
  /** Where hooks modules run; each in a VM of its own (`vm-runtime.ts`) by default. */
  runtime?: ModRuntime
  /** The clock the VMs are timed on; tests drive their own. */
  clock?: VmClock
  print?: (level: 'log' | 'error', line: string) => void
}

export function createSessionMods(deps: SessionModsDeps) {
  const { ports } = deps
  const live = new Map<string, Live>()
  const roots = new Map<string, string>()
  const compiler = deps.compiler ?? createModuleCompiler()
  const clock = deps.clock ?? systemClock
  const crashes = createCrashes(() => clock.now())
  const { touch, evict, released, ...keeping } = createHostKeeping({
    live,
    clock,
    idleMs: deps.idleMs ?? IDLE_MS,
    maxHosts: deps.maxHosts ?? SESSION_HOSTS,
    ...(deps.turnOf ? { turnOf: deps.turnOf } : {}),
  })
  /**
   * A mod's VM died: the line reported, and the host it ran in goes, rebuilt on its next use. It goes
   * once the work running in it ends: the conversation's other mods share the dead one's thread, and
   * what they were asked meanwhile is answered rather than cut off.
   */
  function died(key: string, sources: readonly ModSource[], plugin: string, reason: string) {
    const source = sources.find((one) => one.plugin === nameOf(plugin))
    if (!source) return
    ports.report(source.plugin, crashes.died(source, reason))
    const kept = live.get(key)
    if (!kept || kept.sources !== sources) return
    live.delete(key)
    void released(key).then(() => disposeOf(kept))
  }

  async function build(scene: ModScene, sources: readonly ModSource[]): Promise<KitModsHost> {
    const env = processEnv()
    const read = () =>
      readClaudeSettings({
        homeDir: deps.homeDir,
        cwd: scene.cwd,
        env,
        ...(deps.managed !== undefined ? { managed: deps.managed } : {}),
      })
    const settings = await read()
    const locations = hostLocations({
      homeDir: deps.homeDir,
      projectDir: () => scene.cwd,
      pluginRoot: (pluginId) => roots.get(nameOf(pluginId)) ?? '',
    })
    let host: KitModsHost | undefined
    const turn = createRunTools({
      surface: () => deps.turnOf?.(scene),
      cwd: scene.cwd,
      agentType: (name) => host?.registered.agent(name)?.definition,
    })
    host = createModsHost({
      ports: {
        clock: systemClock,
        locations: {
          ...locations,
          pluginData: async (pluginId) => ports.dataDir(nameOf(pluginId)),
        },
        fs: diskModFs,
        runner: hostCommandRunner({ maxOutputBytes: 1024 * 1024 }),
        spawner: bunModSpawner,
        fetcher: fetchModFetcher(),
        env: sessionModEnv(env),
        store: fileModStore((plugin) => ports.dataDir(plugin)),
        mcp: turn.mcp,
        ...createSessionPorts({
          ports,
          scene,
          composer: deps.composer,
          builtIns: deps.builtIns,
          turn,
          settings: read,
          ...(deps.compact ? { compact: () => deps.compact!(scene) } : {}),
          ...(deps.compose ? { compose: () => deps.compose!(scene) } : {}),
        }),
      },
      iface: createSessionInterface({
        ports,
        scene,
        composer: deps.composer,
        rerun: deps.rerun,
        turn,
        screen: {
          shownPane: () => deps.screen?.shownPane(keyOf(scene)),
          focusedPane: () => deps.screen?.focusedPane(keyOf(scene)),
        },
      }),
      runtime:
        deps.runtime ??
        createVmRuntime({
          // The conversation's mods share a worker, as Claude Code runs a session's mods on one
          // thread; each still has a QuickJS VM and a heap of its own.
          vms: deps.vms.thread(),
          ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
          hangMs: deps.hangMs ?? 10_000,
          memoryLimitBytes: deps.memoryLimitBytes ?? 64 * 1024 * 1024,
          clock,
          ...(deps.print ? { print: deps.print } : {}),
          report: (plugin, message) => ports.report(plugin, message),
          died: (plugin, reason) => died(keyOf(scene), sources, plugin, reason),
        }),
      compiler,
      // Which hook made a call: a VM's calls run in the context their hook's run was in
      // (`stand-in.ts`), so a mod's call skips its calling hook alone.
      asyncContext: () => new AsyncLocalStorage(),
      policy: sessionPolicy(settings, sources, env),
      deny: sessionDeny(settings, scene.cwd, deps.homeDir),
      report: (report) => reportLine(ports, report.line, [report.plugin], report.plugin),
      onNotice: (notice) =>
        reportLine(
          ports,
          notice.line,
          sources.map((one) => one.plugin),
        ),
    })
    // A command, tool or subagent type a mod registered: clients re-read the mods.
    host.registered.onChange(() => ports.changed())
    return host
  }

  return {
    /**
     * The scene's host with `sources` loaded; a host whose mods changed is replaced. Calls that
     * arrive while it loads wait for the same host.
     */
    hostFor(scene: ModScene, wanted: readonly ModSource[]): Promise<KitModsHost> {
      const key = keyOf(scene)
      const sources = wanted.filter((source) => !crashes.benched(source))
      const revision = revisionOf(sources)
      const kept = live.get(key)
      if (kept?.revision === revision) {
        live.delete(key)
        live.set(key, kept)
        touch(key, kept)
        return kept.host
      }
      const entry: Omit<Live, 'host'> & Partial<Live> = { revision, scene, sources }
      const next = (entry.host = (async () => {
        await disposeOf(kept, 'resume')
        for (const source of sources) roots.set(source.plugin, source.root)
        const host = await build(scene, sources)
        const report = await host.load(sources.map(modPluginOf))
        for (const line of report.lines)
          reportLine(
            ports,
            line,
            sources.map((one) => one.plugin),
          )
        entry.ready = { kit: host, failures: failuresOf(sources, report) }
        return host
      })())
      live.delete(key)
      live.set(key, entry as Live)
      touch(key, entry as Live)
      void next.then(evict, () => live.get(key)?.host === next && live.delete(key))
      return next
    },
    /** `work` runs in the scene's host, which is kept while it runs (`host-keeping.ts`). */
    holding: keeping.holding,
    /** The scene's host when it is loaded already, without loading one. */
    loadedFor: (scene: ModScene) => live.get(keyOf(scene))?.host,
    /** The hosts loaded now, the most recently used last. */
    hosts(): LiveHost[] {
      return [...live].flatMap(([key, { scene, ready }]) =>
        ready ? [{ key, scene, kit: ready.kit, failures: ready.failures }] : [],
      )
    },
    /**
     * The mods to run changed: a host that loaded a mod now gone or changed goes, `session.end`
     * heard, and the next use loads the mods anew.
     */
    async retire(next: readonly ModSource[]) {
      const revisions = new Map(next.map((source) => [source.plugin, source.revision]))
      for (const [key, entry] of Array.from(live)) {
        const stale = entry.sources.find(
          (source) => revisions.get(source.plugin) !== source.revision,
        )
        if (!stale) continue
        live.delete(key)
        await disposeOf(entry, revisions.has(stale.plugin) ? 'resume' : 'other')
      }
    },
    /** The conversation ended: its host goes. */
    async drop(scene: ModScene) {
      const kept = live.get(keyOf(scene))
      live.delete(keyOf(scene))
      await disposeOf(kept)
    },
    async stop() {
      const hosts = [...live.values()]
      live.clear()
      for (const entry of hosts) await disposeOf(entry)
    },
    size: () => live.size,
    /** The mods stopped for good after dying too often, by plugin, with why. */
    stopped: crashes.stopped,
  }
}

export type SessionMods = ReturnType<typeof createSessionMods>
