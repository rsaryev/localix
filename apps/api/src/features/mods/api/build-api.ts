import { elementTable, type ModsApi } from '@localixai/claude-plugin/mods'
import { currentScene, stringOr, type ModScene, type ModSource, type ModsPorts } from '../contracts'
import type { ModComposer } from '../composer'
import { DESCRIBING_CORES, type ModEventCalls } from '../event-calls'
import type { ModRegistry } from '../registry'
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

/**
 * One mod's `$`: the mods API bound to Localix. Calls act in the scene of the event being handled
 * (its conversation and working directory), else in the workspace.
 */

/** A screen call Claude Code answers with `{ deny }` when the surface cannot do it. */
const denied = (reason: string) => () => ({ deny: reason })

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

  const run = createRunApi(() => deps.runOf(scene().sessionId))
  const session = createSessionApi({
    scene,
    ports,
    run: (argv, cwd) => system.process.run(argv, { cwd, timeoutMs: 5_000 }),
    append: (sessionId, text) => {
      deps.composer.note(sessionId, text)
      ports.log(scene(), { plugin, text })
    },
    compact: () => deps.calls.compact(scene()),
  })

  /**
   * `$.ui.open`: the pane opens in the Mods tab. One that asks for the keyboard (`focus`) is
   * brought forward there, so it is placed; one that does not waits in the tab's list, as Claude
   * Code's waits undrawn, until the person opens it.
   */
  const openPane = (args: unknown) => {
    const pane = (args ?? {}) as Record<string, unknown>
    for (const flag of ['focus', 'closeOnEscape', 'holdToasts'])
      if (flag in pane && pane[flag] !== true)
        throw new Error(`ui.open: ${flag} is true or left out`)
    const sessionId = scene().sessionId
    registry.openPane(instance, {
      id: pane.id as string,
      ...(typeof pane.title === 'string' ? { title: pane.title } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(pane.closeOnEscape === true ? { closeOnEscape: true } : {}),
      focus: pane.focus === true,
    })
    return pane.focus === true
      ? { isPlaced: true }
      : { isPlaced: false, reason: 'listed in the Mods tab until the person opens it' }
  }

  const api: ModsApi = {
    plugin: { name: plugin, root: source.root },
    command: {
      register: (spec: { name: string; description: string; argumentHint?: string }) =>
        registry.addCommand(instance, spec),
      list: () =>
        registry.commands().map((command) => ({
          name: command.name,
          description: command.description,
          source: 'plugin',
          plugin: command.plugin,
        })),
      run: (input: { command: string; args?: string }) => deps.runCommand(input),
      describe: DESCRIBING_CORES.command.describe,
    },
    tool: {
      register: (spec: {
        name: string
        description: string
        inputSchema?: Record<string, unknown>
      }) => registry.addTool(instance, spec),
      list: run.tool.list,
      call: run.tool.call,
      check: run.tool.check,
      describe: DESCRIBING_CORES.tool.describe,
    },
    mcp: run.mcp,
    agent: {
      ...createAgentApi({
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
    ui: {
      resolve: (e?: { component?: unknown }) =>
        (typeof e?.component === 'string' ? deps.tableOf(e.component) : undefined) ??
        elementTable(),
      invalidate: (event: unknown) => deps.calls.invalidate(event),
      open: (args: unknown) => openPane(args),
      close: (pane: { id: string } | string) =>
        registry.closePane(instance, typeof pane === 'string' ? pane : pane.id),
      panes: () => registry.panes(instance).map(({ id, title }) => ({ id, title })),
      toast: (text: unknown) => ports.notify(scene(), { plugin, text: textOf(text), tone: 'info' }),
      notify: (text: unknown) =>
        ports.notify(scene(), { plugin, text: textOf(text), tone: 'attention' }),
      // The conversation's status line, a line per mod, as Claude Code's status bar shows it.
      status: (text: unknown) => {
        const sessionId = scene().sessionId
        if (sessionId)
          deps.composer.status(sessionId, plugin, text == null ? undefined : textOf(text))
      },
      log: (text: unknown) => ports.log(scene(), { plugin, text: textOf(text) }),
      // A note under one tool call's card in Claude Code; a line in the conversation here.
      notice: (_toolUseId: unknown, text: unknown) =>
        text === undefined ? undefined : ports.log(scene(), { plugin, text: textOf(text) }),
      // Localix scrolls and focuses a pane the way the person does, and draws no raster.
      scroll: denied('Localix scrolls a pane as the person does'),
      focus: denied('Localix moves focus as the person does'),
      blit: denied('the desktop surface draws no terminal raster'),
      ask: run.ui.ask,
    },
    store: createStoreApi(ports.dataDir(plugin)),
    state: createStateApi({ plugin, space: deps.instance.cwd, spaces: deps.state }),
    fs: createFsApi(() => scene().cwd),
    http: system.http,
    process: system.process,
    env: system.env,
    clock: system.clock,
    session,
    prompt: {
      submit: (input: { text: string; asUser?: boolean }) =>
        ports.submitPrompt(scene(), {
          text: textOf(input),
          asUser: input?.asUser === true,
          plugin,
        }),
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
      messages: () => session.messages(),
    }),
  }
  return { api, dispose: () => system.dispose() }
}
