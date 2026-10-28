import type { elementTable, ModsApi } from '@localixai/claude-plugin/mods'
import {
  currentScene,
  stringOr,
  submittedContent,
  type ModScene,
  type ModSource,
  type ModsPorts,
} from '../contracts'
import type { ModComposer } from '../composer'
import { DESCRIBING_CORES, type ModEventCalls } from '../event-calls'
import type { ModRegistry } from '../registry'
import { modToolName } from '../tool-call'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createAgentApi } from './agent-api'
import { createAudioApi } from './audio-api'
import { createFsApi } from './fs-api'
import { createModelApi } from './model-api'
import { createRunApi, type RunSurface } from './run-api'
import { createSettingsApi } from './settings-api'
import { createSessionApi } from './session-api'
import { createStateApi, type StateSpaces } from './state-api'
import { createStoreApi } from './store-api'
import { createSystemApi } from './system-api'
import { createUiApi } from './ui-api'

/**
 * One mod's `$`: the mods API bound to Localix. Calls act in the scene of the event being handled
 * (its conversation and working directory), else in the workspace.
 */

export interface ModApiDeps {
  source: ModSource
  /** The instance this `$` belongs to (`instance-id.ts`) and the project it runs in. */
  instance: { id: string; cwd: string }
  ports: ModsPorts
  registry: ModRegistry
  /** `$.command.run`: the command through `command.run`, as a person typing it would. */
  runCommand: (input: { command: string; args?: string }) => Promise<unknown>
  /** The conversations' prompt boxes and status lines (`$.prompt.fill`, `$.ui.status`). */
  composer: ModComposer
  /** The element table resolved for a component as the instance joined (`ui.resolve`). */
  tableOf: (component: string) => ReturnType<typeof elementTable> | undefined
  /** The running turn of the scene's conversation, which lends `$.tool` and `$.mcp` its tools. */
  runOf: (sessionId: string | undefined) => RunSurface | undefined
  /** The engine's own events a call asks (`$.prompt.compose`, `$.session.compact`). */
  calls: ModEventCalls
  /** `$.state`: the host's, so a value outlives a reload; this instance's project is its space. */
  state: StateSpaces
}

export function buildModApi(deps: ModApiDeps): { api: ModsApi; dispose: () => void } {
  const { source, ports, registry } = deps
  const plugin = source.plugin
  const instance = deps.instance.id
  // A timer's or a closure's call made outside any event acts in the instance's project.
  const fallback: ModScene = { userId: '', cwd: deps.instance.cwd }
  const scene = () => currentScene(fallback)
  const system = createSystemApi({
    cwd: () => scene().cwd,
    onTimerError: (call, error) =>
      ports.report(plugin, `${call}: ${error instanceof Error ? error.message : String(error)}`),
  })
  const textOf = (input: unknown) =>
    typeof input === 'string' ? input : stringOr((input as { text?: unknown } | null)?.text)

  const run = createRunApi(
    () => deps.runOf(scene().sessionId),
    () => scene().cwd,
  )
  const session = createSessionApi({
    scene,
    ports,
    run: (argv, cwd) => system.process.run(argv, { cwd, timeoutMs: 5_000 }),
    agentIds: async () =>
      ((await ports.listAgentRuns?.(scene()).catch(() => [])) ?? []).map((run) => run.sessionId),
    append: (sessionId, text) => {
      deps.composer.note(sessionId, text)
      ports.log(scene(), { plugin, text })
    },
    compact: () => deps.calls.compact(scene()),
  })

  const api: ModsApi = {
    plugin: { name: plugin, root: source.root },
    command: {
      register: async (spec: {
        name: string
        description: string
        argumentHint?: string
        immediate?: unknown
      }) => {
        if (spec.immediate !== undefined && spec.immediate !== true)
          throw new Error('command.register: immediate is true or left out')
        const builtins = (await ports.listCommands?.(scene()).catch(() => [])) ?? []
        if (builtins.some((c) => c.source === 'builtin' && c.name === spec.name))
          throw new Error(`command.register: /${spec.name} is a built-in command`)
        registry.addCommand(instance, spec as Parameters<typeof registry.addCommand>[1])
        return { command: spec.name }
      },
      // Localix's commands and skills, then the mods' own, as the typeahead lists them.
      list: async () => [
        ...((await ports.listCommands?.(scene()).catch(() => [])) ?? []),
        ...registry.commands().map((command) => ({
          name: command.name,
          description: command.description,
          source: 'plugin' as const,
          plugin: command.plugin,
          ...(command.immediate ? { immediate: true } : {}),
        })),
      ],
      run: (input: { command: string; args?: string }) => deps.runCommand(input),
      describe: DESCRIBING_CORES.command.describe,
    },
    tool: {
      register: (spec: {
        name: string
        description: string
        inputSchema?: Record<string, unknown>
      }) => {
        registry.addTool(instance, spec)
        return { tool: modToolName(plugin, spec.name) }
      },
      list: run.tool.list,
      call: (input: unknown) => run.tool.call(input),
      check: (input: unknown) => run.tool.check(input),
      describe: DESCRIBING_CORES.tool.describe,
    },
    mcp: {
      ...run.mcp,
      // A plugin's MCP servers connect with the plugin, as Localix enables it, never on a call.
      connect: (server: unknown) => ({
        isConnected: false,
        reason: 'unlisted',
        message: `Localix connects ${String(server)} with its plugin, when the plugin is enabled`,
      }),
    },
    agent: {
      ...createAgentApi({
        plugin,
        report: ports.report,
        instance,
        registry,
        scene,
        surface: () => deps.runOf(scene().sessionId),
        ...(ports.listAgentRuns ? { listRuns: ports.listAgentRuns } : {}),
      }),
      ...DESCRIBING_CORES.agent,
    },
    skill: DESCRIBING_CORES.skill,
    attribution: DESCRIBING_CORES.attribution,
    turn: {
      abort: async () => {
        if (!ports.abortTurn) throw new Error('turn.abort: no conversation to stop')
        await ports.abortTurn(scene())
      },
    },
    audio: createAudioApi({
      run: (argv) => system.process.run(argv, { timeoutMs: 120_000 }),
      root: source.root,
      download: async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`audio.play: ${url} answered ${response.status}`)
        const dir = join(ports.dataDir(plugin), 'audio')
        const name = createHash('sha256').update(url).digest('hex').slice(0, 16)
        await fs.mkdir(dir, { recursive: true })
        const file = join(
          dir,
          `${name}${/\.[a-z0-9]{2,4}$/i.exec(new URL(url).pathname)?.[0] ?? ''}`,
        )
        await fs.writeFile(file, new Uint8Array(await response.arrayBuffer()))
        return file
      },
    }),
    // Claude Code's /config menu rows; Localix keeps its settings elsewhere, so it lists none.
    config: {
      list: () => [],
      set: (args: { key?: unknown }) => {
        throw new Error(`config.set: no row named ${String(args?.key)}`)
      },
    },
    settings: createSettingsApi({ cwd: () => scene().cwd, homeDir: ports.homeDir ?? '' }),
    ui: createUiApi({
      plugin,
      instance,
      scene,
      ports,
      registry,
      composer: deps.composer,
      tableOf: deps.tableOf,
      invalidate: (event) => deps.calls.invalidate(event),
      ask: (question, options) => run.ui.ask(question, options),
    }),
    store: createStoreApi(ports.dataDir(plugin)),
    state: createStateApi({ plugin, space: deps.instance.cwd, spaces: deps.state }),
    fs: createFsApi(() => scene().cwd),
    http: system.http,
    process: {
      ...system.process,
      spawn: () => {
        throw new Error('process.spawn: Localix streams no child into a mod; use $.process.run')
      },
    },
    env: system.env,
    clock: system.clock,
    session: {
      ...session,
      identity: () => ({
        deny: 'Localix reaches models through its own provider connections, not a Claude account',
      }),
      send: () => ({
        isDelivered: false,
        reason: 'Localix delivers between conversations through its own agents, not a mod',
      }),
    },
    prompt: {
      // What entered: the text, any context, and the origin the hooks passed down.
      submit: async (input: {
        text: string
        asUser?: boolean
        context?: unknown
        origin?: unknown
      }) => {
        const text = textOf(input)
        const sent = { text, asUser: input?.asUser === true, plugin }
        // The hooks heard this prompt as the call: its turn must not raise `prompt.submit` again.
        const sessionId = scene().sessionId
        const content = submittedContent(sent)
        if (sessionId) deps.composer.submitted(sessionId, content)
        await ports.submitPrompt(scene(), sent).catch((error: unknown) => {
          if (sessionId) deps.composer.takeSubmitted(sessionId, content)
          throw error
        })
        return {
          text,
          ...(Array.isArray(input?.context) ? { context: input.context } : {}),
          origin: input?.origin ?? { kind: 'plugin', name: plugin },
        }
      },
      // The box's draft lives in the window; a mod sees none, as where no box is mounted.
      read: () => ({ text: '', cursor: 0 }),
      fill: (input: { text?: unknown; mode?: unknown }) => {
        const sessionId = scene().sessionId
        const text = textOf(input)
        if (!sessionId) return { isFilled: false, text: '', cursor: 0 }
        deps.composer.fill(sessionId, text, input?.mode)
        return { isFilled: true, text, cursor: text.length }
      },
      suggest: (input: { text?: unknown }) => {
        const sessionId = scene().sessionId
        if (sessionId) deps.composer.suggest(sessionId, textOf(input))
        return { isShown: Boolean(sessionId) }
      },
      compose: (args: unknown) => deps.calls.compose(scene(), args),
      ...DESCRIBING_CORES.prompt,
    },
    model: createModelApi({
      complete: (request) => ports.complete(scene(), request),
      messages: async () => (await ports.readSession?.(scene()))?.messages ?? [],
      // A fork reads what the conversation's model read: its system prompt as last composed.
      systemPrompt: async () => {
        const { sections } = (await deps.calls.compose(scene(), {})) as {
          sections: readonly { text?: unknown }[]
        }
        return sections
          .map((section) => (typeof section.text === 'string' ? section.text : ''))
          .filter(Boolean)
          .join('\n\n')
      },
    }),
  }
  return { api, dispose: () => system.dispose() }
}
