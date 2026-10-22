import { join } from 'node:path'
import {
  createModsEngine,
  type ModsEngineOptions,
  type RegisterFunction,
} from '@localixai/claude-plugin/mods'
import { buildModApi } from './api/build-api'
import { inScene, type ModScene, type ModSource, type ModsPorts } from './contracts'
import { buildHooksModule } from './module-build'
import { createModPanes } from './panes'
import { createModRegistry } from './registry'

/**
 * The process-wide mods host: every enabled plugin with a hooks module is loaded here once, keeps
 * its hooks and what it registered across conversations, and is reloaded when its module or
 * options change. `session.start` fires once per load, `session.end` when a mod unloads (the
 * plugin turned off or changed, or Localix stopping) — a Localix process is the session a mod
 * lives in. Conversations fire the rest through `dispatch`, limited to the mods enabled there.
 */

interface LoadedMod {
  revision: string
  dispose(): void
}

export interface ModsHostOptions {
  engine?: ModsEngineOptions
  /** Builds and imports a hooks module; tests supply their own. */
  build?: (source: ModSource, outDir: string) => Promise<RegisterFunction>
}

export function createModsHost(ports: ModsPorts, options: ModsHostOptions = {}) {
  const engine = createModsEngine({ report: ports.report, ...options.engine })
  const registry = createModRegistry(() => ports.changed())
  const loaded = new Map<string, LoadedMod>()
  const failures = new Map<string, string>()
  const background: ModScene = { userId: '', cwd: ports.workspaceDir }
  const build =
    options.build ??
    ((source: ModSource, outDir: string) =>
      buildHooksModule({ module: source.module, root: source.root, outDir }))
  let lifecycle: Promise<void> = Promise.resolve()

  const dispatch = (
    event: string,
    input: unknown,
    core: (event: unknown) => unknown,
    scene: ModScene = background,
    plugins?: ReadonlySet<string>,
  ) => inScene(scene, () => engine.dispatch(event, input, core, { plugins }))

  async function unload(plugin: string, reason: string) {
    const mod = loaded.get(plugin)
    if (!mod) return
    await dispatch('session.end', { reason }, () => ({}), background, new Set([plugin])).catch(
      () => {},
    )
    engine.unload(plugin)
    registry.clear(plugin)
    panes.forget(plugin)
    mod.dispose()
    loaded.delete(plugin)
  }

  async function load(source: ModSource) {
    const { api, dispose } = buildModApi({
      source,
      ports,
      registry,
      runCommand: (_caller, input) => host.runCommand(input, background),
      callTool: async () => {
        throw new Error('$.tool.call is not available in Localix yet')
      },
    })
    try {
      const register = await build(source, join(ports.dataDir(source.plugin), 'mod'))
      await engine.load(source.plugin, register, source.options, api)
      loaded.set(source.plugin, { revision: source.revision, dispose })
      failures.delete(source.plugin)
      await dispatch('session.start', {}, () => ({}), background, new Set([source.plugin]))
    } catch (error) {
      dispose()
      engine.unload(source.plugin)
      registry.clear(source.plugin)
      const message = error instanceof Error ? error.message : String(error)
      failures.set(source.plugin, message)
      ports.report(source.plugin, `the hooks module did not load: ${message}`)
    }
  }

  const panes = createModPanes({ dispatch, registry, changed: ports.changed })

  const host = {
    registry,
    panes,
    /** Load what is new or changed, unload what is gone; serialized, so loads never overlap. */
    reconcile(sources: readonly ModSource[]): Promise<void> {
      lifecycle = lifecycle.then(async () => {
        const wanted = new Map(sources.map((source) => [source.plugin, source]))
        for (const [plugin, mod] of loaded)
          if (wanted.get(plugin)?.revision !== mod.revision)
            await unload(plugin, wanted.has(plugin) ? 'resume' : 'other')
        for (const source of sources) if (!loaded.has(source.plugin)) await load(source)
        for (const plugin of failures.keys()) if (!wanted.has(plugin)) failures.delete(plugin)
      })
      return lifecycle
    },
    dispatch,
    hears: (event: string, plugins?: ReadonlySet<string>) => engine.hears(event, plugins),
    loaded: () => [...loaded.keys()],
    /** Why a mod that should run did not load, by plugin. */
    failures: () => new Map(failures),
    /** A mod's command, through `command.run`: its hooks answer it; nothing else runs it. */
    async runCommand(
      input: { command: string; args?: string; plugin?: string },
      scene: ModScene,
      plugins?: ReadonlySet<string>,
    ): Promise<{ text?: string; context?: readonly string[] }> {
      const event = { command: input.command, args: input.args ?? '', origin: { kind: 'composer' } }
      const result = await dispatch('command.run', event, () => ({}), scene, plugins)
      return (result && typeof result === 'object' ? result : {}) as { text?: string }
    },
    stop(): Promise<void> {
      lifecycle = lifecycle.then(async () => {
        for (const plugin of Array.from(loaded.keys())) await unload(plugin, 'other')
      })
      return lifecycle
    },
  }
  return host
}

export type ModsHost = ReturnType<typeof createModsHost>
