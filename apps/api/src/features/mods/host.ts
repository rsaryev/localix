import {
  createModsEngine,
  type HookOrigin,
  type ModsEngineOptions,
} from '@localixai/claude-plugin/mods'
import { createAnswerCache } from './answer-cache'
import { buildModApi } from './api/build-api'
import { createStateSpaces } from './api/state-api'
import type { RunSurface } from './api/run-api'
import { commandAnswer, commandRunEvent, type CommandInput } from './command-run'
import { createModComposer } from './composer'
import { createModConversations } from './conversations'
import { createEventCalls } from './event-calls'
import { inScene, type ModScene, type ModSource, type ModsPorts } from './contracts'
import { createHooksLoader, type HooksOptions, type LoadedMod } from './hooks-load'
import { instanceIdOf, pluginOfInstance, type ModInstance } from './instance-id'
import { judgeJoin, resolveTables } from './joining'
import { createMeasurer } from './measure'
import type { ModVm } from './isolation/mod-vm'
import { createModPanes } from './panes'
import { createModRegistry } from './registry'
import { createModHealth, RESTART_RULES, SUPERVISOR_CLOCK } from './restarts'

/**
 * The process-wide mods host. Every enabled plugin with a hooks module is bundled here once, and
 * runs once per project, as a Claude Code session runs in one directory: an instance per working
 * directory, started (`session.start` with that `cwd`) the first time a conversation there needs
 * it, and one for the workspace at load, so a mod's commands and panes are there before any chat.
 * An instance runs in a VM of its own (`hooks-load.ts`); one whose VM died starts again,
 * later or not at all when it keeps dying (`restarts.ts`). `session.end` fires when it goes — its
 * plugin turned off or changed, Localix stopping, or the instance the least recently used past it.
 */

/** Projects a plugin's mod runs in at once; the least recently used beyond them stops. */
const INSTANCES_PER_PLUGIN = 8

/** Why the mods running in a project refused one more (`plugin.register`). */
class ModRefusedError extends Error {}

export interface ModsHostOptions extends HooksOptions {
  engine?: ModsEngineOptions
}

export function createModsHost(ports: ModsPorts, options: ModsHostOptions = {}) {
  const engine = createModsEngine({
    report: (instance, event, reason) =>
      ports.report(pluginOfInstance(instance), `${event}: ${reason}`),
    pluginOf: pluginOfInstance,
    // A mod's `$` calls reach the hooks of the mods running in its project, not another's.
    peersOf: (id) => sceneOf(id).instances,
    ...options.engine,
  })
  const registry = createModRegistry(() => ports.changed())
  const composer = createModComposer(() => ports.changed())
  const answers = createAnswerCache()
  const conversations = createModConversations()
  const state = createStateSpaces({ changed: () => ports.changed() })
  const sources = new Map<string, LoadedMod>()
  const instances = new Map<string, ModInstance>()
  const starting = new Map<string, Promise<string | null>>()
  const clock = options.clock ?? SUPERVISOR_CLOCK
  const health = createModHealth({ ...RESTART_RULES, ...options.restarts }, clock.now, ports.report)
  /** The running turn of each conversation with mods, lending them its tools. */
  const runs = new Map<string, RunSurface>()
  let lifecycle: Promise<void> = Promise.resolve()

  const dispatch = (
    event: string,
    input: unknown,
    core: (event: unknown) => unknown,
    scene: ModScene,
    ids?: ReadonlySet<string>,
    origin?: HookOrigin,
  ) => inScene(scene, () => engine.dispatch(event, input, core, { plugins: ids, origin }))

  const sceneOf = (id: string) => {
    const cwd = instances.get(id)?.cwd ?? ports.workspaceDir
    const peers = [...instances].filter(([, instance]) => instance.cwd === cwd)
    return { scene: { userId: '', cwd }, instances: new Set(peers.map(([peer]) => peer)) }
  }

  const hooksLoader = createHooksLoader({
    ...options,
    clock,
    ports,
    apiOf: (id) => engine.apiOf(id),
    died(id, vm, reason) {
      // A VM that died loading fails its load, which reports it (`start`).
      if (instances.get(id)?.vm !== vm) return
      drop(id)
      const plugin = pluginOfInstance(id)
      if (health.died(plugin, reason))
        for (const [other, one] of Array.from(instances)) if (one.plugin === plugin) drop(other)
      ports.changed()
    },
  })

  async function start(plugin: string, cwd: string): Promise<string | null> {
    const loaded = sources.get(plugin)
    if (!loaded) return null
    const id = instanceIdOf(plugin, cwd)
    const scene: ModScene = { userId: '', cwd }
    let tables: Awaited<ReturnType<typeof resolveTables>> | undefined
    let vm: ModVm | undefined
    const { api, dispose: disposeApi } = buildModApi({
      source: loaded.source,
      instance: { id, cwd },
      ports,
      registry,
      composer,
      runCommand: (input) => host.runCommand(input, scene, new Set([plugin])),
      runOf: (sessionId) => (sessionId ? runs.get(sessionId) : undefined),
      tableOf: (component) => tables?.get(component),
      calls,
      state,
    })
    const dispose = () => void [disposeApi(), vm?.stop()]
    try {
      const judges = sceneOf(id).instances
      const hooks = await hooksLoader.load(loaded, id)
      vm = hooks.vm
      const events = await engine.load(id, hooks.register, loaded.source.options, api)
      const refused = await judgeJoin(dispatch, scene, judges, {
        plugin,
        root: loaded.source.root,
        events,
      })
      if (refused !== undefined) throw new ModRefusedError(`refused by a mod: ${refused}`)
      // The plugin failed while this start was loading (another instance hit the death limit):
      // it stays stopped, so this instance does not join, and does not clear that failure.
      if (health.failures.has(plugin)) {
        dispose()
        drop(id)
        return null
      }
      instances.set(id, { plugin, cwd, usedAt: Date.now(), dispose, ...(vm ? { vm } : {}) })
      tables = await resolveTables(dispatch, scene, sceneOf(id).instances)
      vm?.setTables(tables)
      health.started(plugin)
      await dispatch(
        'session.start',
        { cwd, surface: 'desktop', isInteractive: true },
        () => ({ cwd }),
        scene,
        new Set([id]),
      )
      await evictBeyondLimit(plugin)
      return id
    } catch (error) {
      dispose()
      drop(id)
      health.fail(plugin, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  /** The plugin's instance in `cwd`, started once however many conversations ask at once. */
  function instanceIn(plugin: string, cwd: string): Promise<string | null> {
    const id = instanceIdOf(plugin, cwd)
    const running = instances.get(id)
    if (running && running.vm?.alive() !== false) {
      running.usedAt = Date.now()
      return Promise.resolve(id)
    }
    // Its VM died: the instance starts again, as at first, once it may.
    if (running) drop(id)
    if (!starting.has(id) && !health.mayStart(plugin)) return Promise.resolve(null)
    const pending = starting.get(id) ?? start(plugin, cwd).finally(() => starting.delete(id))
    starting.set(id, pending)
    return pending
  }

  async function stopInstance(id: string, reason: string) {
    if (!instances.has(id)) return
    const { scene } = sceneOf(id)
    await dispatch('session.end', { reason }, () => ({}), scene, new Set([id])).catch(() => {})
    drop(id)
  }

  /** The instance goes, with what it registered; `session.end` was heard, or cannot be. */
  function drop(id: string) {
    engine.unload(id)
    registry.clear(id)
    panes.forget(id)
    instances.get(id)?.dispose()
    instances.delete(id)
  }

  async function evictBeyondLimit(plugin: string) {
    const own = [...instances]
      .filter(([, instance]) => instance.plugin === plugin && instance.cwd !== ports.workspaceDir)
      .sort(([, a], [, b]) => a.usedAt - b.usedAt)
    for (const [id] of own.slice(0, Math.max(0, own.length - INSTANCES_PER_PLUGIN)))
      await stopInstance(id, 'other')
  }

  async function unload(plugin: string, reason: string) {
    for (const [id, instance] of Array.from(instances))
      if (instance.plugin === plugin) await stopInstance(id, reason)
    composer.forget(plugin)
    sources.delete(plugin)
  }

  async function load(source: ModSource) {
    try {
      health.forget(source.plugin)
      sources.set(source.plugin, await hooksLoader.bundle(source))
    } catch (error) {
      health.fail(source.plugin, error instanceof Error ? error.message : String(error))
      return
    }
    await instanceIn(source.plugin, ports.workspaceDir)
  }

  /** A surface module an instance's `Client`s may run (`client-modules.ts`). */
  const clientOf = (id: string, module: string) =>
    sources.get(pluginOfInstance(id))?.clients.get(module)
  const calls = createEventCalls(() => host)
  const panes = createModPanes({ dispatch, registry, changed: ports.changed, sceneOf, clientOf })

  const host = {
    registry,
    panes,
    composer,
    ports,
    /** The describing events' answers, kept per conversation (`answer-cache.ts`). */
    answers,
    conversations,
    state, // `$.state` by project; `state.reset(cwd)` is Claude Code's `/clear` of one
    /** Load what is new or changed, unload what is gone; serialized, so loads never overlap. */
    reconcile(wanted: readonly ModSource[]): Promise<void> {
      lifecycle = lifecycle.then(async () => {
        const byPlugin = new Map(wanted.map((source) => [source.plugin, source]))
        for (const [plugin, loaded] of Array.from(sources))
          if (byPlugin.get(plugin)?.revision !== loaded.source.revision)
            await unload(plugin, byPlugin.has(plugin) ? 'resume' : 'other')
        for (const source of wanted) if (!sources.has(source.plugin)) await load(source)
        health.keep(byPlugin)
      })
      return lifecycle
    },
    /**
     * The instances a conversation's events go to: each enabled plugin's mod in the scene's
     * working directory, started when it is not running yet.
     */
    async instancesFor(scene: ModScene, plugins: ReadonlySet<string>): Promise<Set<string>> {
      const ids = await Promise.all(
        [...sources.keys()]
          // A module that failed to start is not retried every turn; a change reloads it.
          .filter((plugin) => plugins.has(plugin) && !health.failures.has(plugin))
          .map((plugin) => instanceIn(plugin, scene.cwd)),
      )
      return new Set(ids.filter((id): id is string => id !== null))
    },
    dispatch,
    /** After a turn: the conversation's usage to the mods that hear `session.measure`. */
    measure: createMeasurer({
      ...(ports.readSession ? { read: ports.readSession } : {}),
      dispatch,
      hears: (event, ids) => engine.hears(event, ids),
    }),
    /** A conversation's turn lends its tools to `$.tool` and `$.mcp` while it runs. */
    attachRun: (sessionId: string, surface: RunSurface) => void runs.set(sessionId, surface),
    detachRun: (sessionId: string) => void runs.delete(sessionId),
    hears: (event: string, ids?: ReadonlySet<string>) => engine.hears(event, ids),
    /** `$.ui.invalidate(event)`: the event's kept answers go, and clients re-read the mods. */
    invalidate(event: unknown) {
      if (typeof event === 'string') answers.invalidate(event)
      ports.changed()
    },
    /** The plugins whose mod is loaded. */
    loaded: () => [...sources.keys()].filter((plugin) => !health.failures.has(plugin)),
    /** Where each instance runs, by instance. */
    instances: () => new Map([...instances].map(([id, { plugin, cwd }]) => [id, { plugin, cwd }])),
    /** Why a mod that should run did not load, by plugin. */
    failures: () => new Map(health.failures),
    clientModule: clientOf,
    /** A mod's command, through `command.run` in the scene's project: only mods answer it. */
    async runCommand(input: CommandInput, scene: ModScene, plugins: ReadonlySet<string>) {
      const ids = await host.instancesFor(scene, plugins)
      return commandAnswer(
        await dispatch('command.run', commandRunEvent(input), () => ({}), scene, ids),
      )
    },
    stop(): Promise<void> {
      lifecycle = lifecycle.then(async () => {
        for (const plugin of Array.from(sources.keys())) await unload(plugin, 'other')
      })
      return lifecycle
    },
  }
  return host
}

export type ModsHost = ReturnType<typeof createModsHost>

export { INERT_MOD_PORTS } from './contracts'
