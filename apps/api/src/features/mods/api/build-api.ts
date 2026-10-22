import { elementTable, type ModsApi } from '@localixai/claude-plugin/mods'
import { currentScene, type ModScene, type ModSource, type ModsPorts } from '../contracts'
import type { ModRegistry } from '../registry'
import { createFsApi } from './fs-api'
import { createStoreApi } from './store-api'
import { createSystemApi } from './system-api'

/**
 * One mod's `$`: the mods API bound to Localix. Calls act in the scene of the event being handled
 * (its conversation and working directory), else in the workspace. What Localix does not offer
 * yet throws a clear error naming the call, so a mod can catch it and degrade.
 */

/** Namespaces Claude Code has that Localix does not run yet, by method. */
const NOT_YET: Record<string, readonly string[]> = {
  agent: ['register', 'spawn', 'list'],
  turn: ['abort'],
  config: ['list', 'set'],
  settings: ['read'],
  state: ['get', 'set'],
  mcp: ['call', 'connect'],
  audio: ['play', 'speak'],
  telemetry: ['log', 'mark'],
}

const notYet = (call: string) => () => {
  throw new Error(`$.${call} is not available in Localix yet`)
}

export interface ModApiDeps {
  source: ModSource
  ports: ModsPorts
  registry: ModRegistry
  /** `$.command.run`: the command through `command.run`, as a person typing it would. */
  runCommand(plugin: string, input: { command: string; args?: string }): Promise<unknown>
  /** `$.tool.call` for a mod's own tool. */
  callTool(plugin: string, input: Record<string, unknown>): Promise<unknown>
}

export function buildModApi(deps: ModApiDeps): { api: ModsApi; dispose(): void } {
  const { source, ports, registry } = deps
  const plugin = source.plugin
  const fallback: ModScene = { userId: '', cwd: ports.workspaceDir }
  const scene = () => currentScene(fallback)
  const system = createSystemApi({ cwd: () => scene().cwd })
  const textOf = (input: unknown) =>
    typeof input === 'string' ? input : String((input as { text?: unknown } | null)?.text ?? '')

  const api: ModsApi = {
    plugin: { name: plugin, root: source.root },
    command: {
      register: (spec: { name: string; description: string; argumentHint?: string }) =>
        registry.addCommand(plugin, spec),
      list: () =>
        registry.commands().map((command) => ({
          name: command.name,
          description: command.description,
          source: 'plugin',
          plugin: command.plugin,
        })),
      run: (input: { command: string; args?: string }) => deps.runCommand(plugin, input),
    },
    tool: {
      register: (spec: {
        name: string
        description: string
        inputSchema?: Record<string, unknown>
      }) => registry.addTool(plugin, spec),
      list: () =>
        registry.tools().map(({ plugin: owner, name, description }) => ({
          name: `mcp__${owner}__${name}`,
          description,
        })),
      call: (input: Record<string, unknown>) => deps.callTool(plugin, input),
      check: notYet('tool.check'),
    },
    ui: {
      resolve: () => elementTable(),
      invalidate: () => ports.changed(),
      open: (pane: { id: string; title?: string; rows?: number; columns?: number }) => {
        registry.openPane(plugin, pane)
        return { isPlaced: true }
      },
      close: (pane: { id: string } | string) =>
        registry.closePane(plugin, typeof pane === 'string' ? pane : pane.id),
      panes: () => registry.panes(plugin).map(({ id, title }) => ({ id, title })),
      toast: (text: unknown) => ports.notify(scene(), { plugin, text: textOf(text), tone: 'info' }),
      notify: (text: unknown) =>
        ports.notify(scene(), { plugin, text: textOf(text), tone: 'attention' }),
      status: (text: unknown) =>
        ports.notify(scene(), { plugin, text: textOf(text), tone: 'info' }),
      log: (text: unknown) => ports.log(scene(), { plugin, text: textOf(text) }),
      notice: (text: unknown) => ports.log(scene(), { plugin, text: textOf(text) }),
      ...Object.fromEntries(
        ['focus', 'scroll', 'ask', 'copy', 'selection', 'blit'].map((name) => [
          name,
          notYet(`ui.${name}`),
        ]),
      ),
    },
    store: createStoreApi(ports.dataDir(plugin)),
    fs: createFsApi(() => scene().cwd),
    http: system.http,
    process: system.process,
    env: system.env,
    clock: system.clock,
    session: {
      id: () => scene().sessionId ?? null,
      cwd: () => scene().cwd,
      root: () => scene().cwd,
      ...Object.fromEntries(
        [
          'messages',
          'model',
          'turns',
          'repo',
          'surfaces',
          'usage',
          'version',
          'compact',
          'send',
          'append',
          'authorize',
        ].map((name) => [name, notYet(`session.${name}`)]),
      ),
    },
    prompt: {
      submit: (input: { text: string; asUser?: boolean }) =>
        ports.submitPrompt(scene(), {
          text: textOf(input),
          asUser: input?.asUser === true,
          plugin,
        }),
      ...Object.fromEntries(
        ['read', 'fill', 'suggest', 'compose'].map((name) => [name, notYet(`prompt.${name}`)]),
      ),
    },
    model: {
      complete: (request: {
        model?: string
        prompt: string
        system?: string
        maxTokens?: number
      }) => ports.complete(scene(), request),
      fork: notYet('model.fork'),
      classify: notYet('model.classify'),
    },
    ...Object.fromEntries(
      Object.entries(NOT_YET).map(([namespace, methods]) => [
        namespace,
        Object.fromEntries(methods.map((name) => [name, notYet(`${namespace}.${name}`)])),
      ]),
    ),
  }
  return { api, dispose: () => system.dispose() }
}
