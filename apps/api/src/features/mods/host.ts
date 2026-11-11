import { homedir } from 'node:os'
import { createDebouncer } from '../../lib/debounce'
import type { JsonObject } from '@rsaryev/llx-plugin/mods'
import type { CommandDef } from '@rsaryev/llx-plugin/mods'
import type { ModsHost as KitModsHost, ModRuntime } from '@rsaryev/llx-plugin/mods'
import type { ManagedSettingsSource } from '../plugins/kit'
import { createAnswerCache } from './answer-cache'
import { createModBand } from './band'
import { bundleClientModules, type ClientBundle } from './client-modules'
import { commandAnswer, type CommandInput } from './command-run'
import { createModComposer } from './composer'
import type { ModScene, ModSource, ModsPorts } from './contracts'
import { createModConversations } from './conversations'
import { createEventCalls } from './event-calls'
import type { ModVmPort, VmClock } from './isolation/mod-vm'
import { createMeasurer } from './measure'
import { createModuleCompiler } from './module-build'
import { createModPanes } from './panes'
import { createSessionMods } from './session/session-host'
import { summarize } from './summary'

/**
 * The process-wide mods host: the plugins whose hooks module runs, and a kit `ModsHost` for each
 * conversation that runs them (`session/session-host.ts`), as Claude Code runs one mods runtime
 * per session, with one more for the workspace, loaded with the mods so their commands and panes
 * are there before any chat. `instancesFor` of the old engine is `hostFor`: the scene's host with
 * the plugins given loaded. A module is built once per revision for every host that loads it.
 */

export interface ModsHostOptions {
  vms: ModVmPort
  runtimeDir?: string
  /** The user's home, where Claude Code's settings live; the process's own by default. */
  homeDir?: string
  /** The names of Localix's own commands. */
  builtIns?: () => readonly string[]
  managed?: ManagedSettingsSource | null
  maxHosts?: number
  /** How long a conversation's host is kept unused (`IDLE_MS` of `session-host.ts` by default). */
  idleMs?: number
  hangMs?: number
  memoryLimitBytes?: number
  /** Where hooks modules run; each in a VM of its own by default. */
  runtime?: ModRuntime
  /** The clock a VM's load and turns are timed on; tests drive their own. */
  clock?: VmClock
  /** How long a refresh waits for more changes before it loads; half a second by default. */
  refreshDelayMs?: number
  /** Where a mod's `console` lines go; the process's console by default. */
  print?: (level: 'log' | 'error', line: string) => void
}

/** The agent types one plugin's mods registered, each name to its definition. */
export interface ModAgentGroup {
  plugin: string
  agents: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

const REFRESH_DELAY_MS = 500

export function createModsHost(ports: ModsPorts, options: ModsHostOptions) {
  const composer = createModComposer(() => ports.changed())
  const answers = createAnswerCache()
  const conversations = createModConversations()
  const stopping = new AbortController()
  const workspace: ModScene = { userId: '', cwd: ports.workspaceDir }
  let wanted: readonly ModSource[] = []
  let lifecycle: Promise<void> = Promise.resolve()
  // A refresh waits a moment so a burst of plugin changes loads once; until it has loaded, a
  // reader that must see the mods (`settled`) waits for it (`refresh`).
  const debounce = createDebouncer(options.refreshDelayMs ?? REFRESH_DELAY_MS)
  const loading = new Set<Promise<void>>()
  let next: ReturnType<typeof Promise.withResolvers<void>> | undefined
  /** Each plugin root's surface modules, bundled for the screen (`client-modules.ts`). */
  const clients = new Map<string, Map<string, ClientBundle>>()
  const compiler = createModuleCompiler({
    revisionOf: (root) => wanted.find((source) => source.root === root)?.revision,
    clients(root, modules) {
      if (modules.size > 0)
        void bundleClientModules(root, modules).then((bundles) => clients.set(root, bundles))
    },
  })
  const report = (hook: { plugin: string; line: string }) => ports.report(hook.plugin, hook.line)
  const sourcesOf = (plugins?: ReadonlySet<string>) =>
    wanted.filter((source) => !plugins || plugins.has(source.plugin))
  const rootOf = (plugin: string) => wanted.find((source) => source.plugin === plugin)?.root

  const sessions = createSessionMods({
    ports,
    composer,
    rerun: (event) => answers.invalidate(event),
    vms: options.vms,
    ...(options.runtimeDir ? { runtimeDir: options.runtimeDir } : {}),
    homeDir: options.homeDir ?? ports.homeDir ?? homedir(),
    builtIns: options.builtIns ?? (() => []),
    compiler,
    ...(options.managed !== undefined ? { managed: options.managed } : {}),
    ...(options.maxHosts ? { maxHosts: options.maxHosts } : {}),
    ...(options.idleMs ? { idleMs: options.idleMs } : {}),
    ...(options.hangMs ? { hangMs: options.hangMs } : {}),
    ...(options.memoryLimitBytes ? { memoryLimitBytes: options.memoryLimitBytes } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.print ? { print: options.print } : {}),
    turnOf: (scene) => (scene.sessionId ? band.runs.get(scene.sessionId) : undefined),
    // The conversation's messages as plain data: what the session store keeps is JSON.
    compact: (scene) => calls.compact(scene) as unknown as Promise<JsonObject>,
    compose: async (scene) => (await calls.compose(scene, {})).sections,
  })

  /** The scene's host with the mods of `plugins` (every loaded one when absent); none without mods. */
  async function hostFor(
    scene: ModScene,
    plugins?: ReadonlySet<string>,
  ): Promise<KitModsHost | undefined> {
    const sources = sourcesOf(plugins)
    return sources.length === 0 ? undefined : sessions.hostFor(scene, sources)
  }

  /**
   * The conversation's running host when it runs every mod of `plugins`: a command runs among the
   * mods the conversation's turn loaded, rather than in a host of its mod alone.
   */
  async function runningHostFor(scene: ModScene, plugins?: ReadonlySet<string>) {
    const kit = await sessions.loadedFor(scene)?.catch(() => undefined)
    const active = new Set(kit?.active().map((mod) => mod.name))
    return kit && [...(plugins ?? [])].every((plugin) => active.has(plugin)) ? kit : undefined
  }

  const calls = createEventCalls(() => host)
  const panes = createModPanes({
    hosts: () =>
      sessions.hosts().map((live) => ({ key: live.key, cwd: live.scene.cwd, kit: live.kit })),
    changed: ports.changed,
    clientRevision: (plugin, module) => clients.get(rootOf(plugin) ?? '')?.get(module)?.revision,
    report,
    signal: stopping.signal,
  })
  const band = createModBand({
    /** Where its latest turn ran; for one that ran none since Localix started, its own folder. */
    async hostOf(sessionId) {
      const joined = conversations.of(sessionId)
      if (joined) return hostFor(joined.scene, joined.plugins)
      const scene: ModScene = { userId: '', sessionId, cwd: ports.workspaceDir }
      const cwd = (await ports.sessionCwd?.(scene).catch(() => null)) ?? ports.workspaceDir
      return hostFor({ ...scene, cwd })
    },
    changed: ports.changed,
    report,
    signal: stopping.signal,
  })
  /** What every loaded host's mods registered, each plugin's entry once. */
  const registeredOnce = <T extends { plugin: string; name: string }>(
    read: (kit: KitModsHost) => readonly T[],
  ): T[] => {
    const seen = new Map<string, T>()
    for (const live of sessions.hosts())
      for (const entry of read(live.kit))
        if (!seen.has(`${entry.plugin}:${entry.name}`))
          seen.set(`${entry.plugin}:${entry.name}`, entry)
    return [...seen.values()]
  }
  const failures = () => {
    const failed = new Map(sessions.stopped())
    for (const live of sessions.hosts())
      for (const [plugin, reason] of live.failures)
        if (rootOf(plugin) !== undefined) failed.set(plugin, reason)
    return failed
  }

  const host = {
    panes,
    /** The band above each conversation's prompt box (`AbovePrompt`). */
    band,
    composer,
    ports,
    /** The describing events' answers, kept per conversation (`answer-cache.ts`). */
    answers,
    conversations,
    hostFor,
    /** The workspace's host: the mods as they run outside any conversation. */
    workspace: () => hostFor(workspace),
    /** Load what is new or changed, retire what is gone; serialized, so loads never overlap. */
    reconcile(next: readonly ModSource[]): Promise<void> {
      lifecycle = lifecycle.then(async () => {
        wanted = next
        await sessions.retire(next)
        await hostFor(workspace)
      })
      return lifecycle
    },
    /**
     * Reload the mods a moment from now (`load` reads what should run), once for a burst of calls:
     * at start and after any plugin change. `settled` waits for it; `loaded` hears it done.
     */
    refresh(
      load: () => Promise<readonly ModSource[]>,
      on: { loaded?: () => void; failed: (error: unknown) => void },
    ): void {
      if (!next) {
        next = Promise.withResolvers<void>()
        loading.add(next.promise)
      }
      debounce.schedule(() => {
        const due = next!
        next = undefined
        void load()
          .then((sources) => host.reconcile(sources))
          .then(on.loaded, on.failed)
          .finally(() => {
            loading.delete(due.promise)
            due.resolve()
          })
      })
    },
    /** Once every refresh asked for so far has loaded (or failed) and nothing else is loading. */
    async settled(): Promise<void> {
      await Promise.all(loading)
      await lifecycle
    },
    /** After a turn: the conversation's usage to the mods that hear `session.measure`. */
    measure: createMeasurer(ports.readSession ? { read: ports.readSession } : {}),
    /** `$.ui.invalidate(event)`: the event's kept answers go, and clients re-read the mods. */
    invalidate(event: unknown) {
      if (typeof event === 'string') answers.invalidate(event)
      ports.changed()
    },
    /** The plugins whose mod is loaded. */
    loaded: () => wanted.map((source) => source.plugin).filter((plugin) => !failures().has(plugin)),
    /** Why a mod that should run did not load, by plugin. */
    failures,
    /** The commands mods registered (`$.command.register`). */
    commands: (): CommandDef[] => registeredOnce((kit) => kit.registered.commands()),
    /** The subagent types mods registered (`$.agent.register`), by plugin. */
    agentGroups(): ModAgentGroup[] {
      const groups = new Map<string, Record<string, Readonly<Record<string, unknown>>>>()
      for (const agent of registeredOnce((kit) => kit.registered.agents()))
        groups.set(agent.plugin, { ...groups.get(agent.plugin), [agent.name]: agent.definition })
      return [...groups].map(([plugin, agents]) => ({ plugin, agents }))
    },
    summary() {
      const kit = sessions.hosts().find((live) => live.key === `workspace:${workspace.cwd}`)?.kit
      return summarize({
        sources: wanted,
        events: new Map(
          (kit?.active() ?? []).map((mod) => [mod.name, mod.hooks.map((hook) => hook.event)]),
        ),
        failures: failures(),
        panes: panes.list(),
      })
    },
    /** A surface module a plugin's `Client`s may run, as the screen names the pane's owner. */
    clientModule(instance: string, module: string): ClientBundle | undefined {
      const root = rootOf(
        instance.includes('~') ? instance.slice(0, instance.lastIndexOf('~')) : instance,
      )
      return root === undefined ? undefined : clients.get(root)?.get(module)
    },
    /** A mod's command, through `command.run` in the scene's conversation: only mods answer it. */
    async runCommand(input: CommandInput, scene: ModScene, plugins?: ReadonlySet<string>) {
      const kit = (await runningHostFor(scene, plugins)) ?? (await hostFor(scene, plugins))
      if (!kit) return commandAnswer(undefined)
      const options = input.origin ? { origin: input.origin } : {}
      return commandAnswer(await kit.runCommand(input.command, input.args ?? '', options))
    },
    /** A deleted conversation: its host goes (`session.end` heard), and what was kept for it. */
    async forget(sessionId: string): Promise<void> {
      conversations.forget(sessionId)
      host.measure.forget(sessionId)
      await sessions.drop({ userId: '', sessionId, cwd: '' })
    },
    stop(): Promise<void> {
      debounce.cancel()
      if (next) loading.delete(next.promise)
      next?.resolve()
      next = undefined
      lifecycle = lifecycle.then(async () => {
        stopping.abort()
        await sessions.stop()
      })
      return lifecycle
    },
  }
  return host
}

export type ModsHost = ReturnType<typeof createModsHost>
