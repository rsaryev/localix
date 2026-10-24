import { AsyncLocalStorage } from 'node:async_hooks'
import type { HookOrigin } from '@localixai/claude-plugin/mods'

/**
 * The mods host's contracts: where an event happens, and the ports the host reaches the rest of
 * Localix through. The composition root (`bootstrap/mods.ts`) binds every port; this feature
 * builds no other feature's service (A4).
 */

/** Where an event happens: the conversation a hook's `$` acts in. */
export interface ModScene {
  userId: string
  /** Absent for an event no conversation started (a timer, a pane button). */
  sessionId?: string
  /** The conversation's working directory; a mod's relative paths resolve against it. */
  cwd: string
}

/** A mod as the host loads it: an enabled plugin whose `hooks/hooks.json` names a module. */
export interface ModSource {
  plugin: string
  /** The plugin root (`$.plugin.root`, `${CLAUDE_PLUGIN_ROOT}`). */
  root: string
  /** The hooks module, absolute and inside the plugin. */
  module: string
  /** The plugin's `userConfig` values, defaults filled in. */
  options: Record<string, unknown>
  /** Changes when the module or the options change, so an unchanged mod is not reloaded. */
  revision: string
}

export interface ModelCompletionRequest {
  model?: string
  /** The one user message, its blocks' texts joined. */
  prompt: string
  system?: string
  maxTokens?: number
  /** How hard the model thinks, by Claude Code's levels. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Aborts the call: the caller's signal, its time limit, or the event abandoned. */
  signal?: AbortSignal
  /** The time limit the caller set; `signal` already carries it. */
  timeoutMs?: number
  /** Earlier turns the prompt follows (`$.model.fork`: the conversation so far). */
  history?: readonly { role: 'user' | 'assistant'; text: string }[]
}

/** A reply's tokens, as Claude Code reports them. */
export interface ModelUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const NO_USAGE: ModelUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

/**
 * What one completion came to, as Claude Code's `$.model.complete` resolves: the reply, or why
 * there was none. Nothing the provider does rejects it.
 */
export type ModelCompletion =
  | { isAnswered: true; text: string; usage: ModelUsage }
  | {
      isAnswered: false
      reason: 'api-error'
      /** The error reply's HTTP status; null when no response arrived. */
      status: number | null
      /** The failure's kind (`rate_limit`, `overloaded`, ...), never its text. */
      error: string
      usage: ModelUsage
    }
  | { isAnswered: false; reason: 'empty-reply' | 'aborted'; usage: ModelUsage }

/** One message of a conversation as Claude Code's `$.session.messages()` gives it. */
export interface ModSessionMessage {
  role: 'user' | 'assistant'
  text: string
  /** Each call with its result: the tool's own record and the text the model read. */
  toolUses: {
    tool_use_id: string
    tool: string
    input: Record<string, unknown>
    result?: unknown
    text?: string
  }[]
  toolResults?: { tool_use_id: string; text: string; isError: boolean; result?: unknown }[]
}

/** What a conversation holds for `$.session`; a figure Localix does not have is left out. */
export interface ModSessionRead {
  messages: ModSessionMessage[]
  model: string | null
  /** The live context window: the tokens in it, when measured, and its size. */
  context?: { tokens?: number; window: number }
  /** What the conversation has cost so far, in US dollars. */
  costUsd?: number
  /** When the conversation began, in milliseconds since the epoch. */
  startedAt?: number
}

/** A slash command or skill as `$.command.list()` lists it. */
export interface ModCommandInfo {
  name: string
  description: string
  source: 'builtin' | 'plugin' | 'user' | 'mcp'
  plugin?: string
}

/** One delegated child of a conversation (`$.agent.list`). */
export interface ModAgentRun {
  sessionId: string
  taskName: string
  status: string
  agentId?: string
  parentSessionId?: string
}

export interface ModsPorts {
  /** Where a mod's data lives (`${CLAUDE_PLUGIN_DATA}`): its store and its built module. */
  dataDir(plugin: string): string
  /** The working directory of an event with no conversation. */
  workspaceDir: string
  /** Start a turn in the scene's conversation (`$.prompt.submit`). */
  submitPrompt(
    scene: ModScene,
    input: { text: string; asUser: boolean; plugin: string },
  ): Promise<void>
  /** One completion through the conversation's own route (`$.model.complete`). */
  complete(scene: ModScene, request: ModelCompletionRequest): Promise<ModelCompletion>
  /** A dim line in the conversation's transcript that the model does not read (`$.ui.log`). */
  log(scene: ModScene, input: { plugin: string; text: string }): void
  /** A short-lived message on screen (`$.ui.toast`, `$.ui.notify`). */
  notify(scene: ModScene, input: { plugin: string; text: string; tone: 'info' | 'attention' }): void
  /** The user's home, where Claude Code's own settings live (`$.settings.read`). */
  homeDir?: string
  /** Stops the scene's running turn (`$.turn.abort`). */
  abortTurn?: (scene: ModScene) => Promise<void>
  /** The scene's conversation's delegated children (`$.agent.list`). */
  listAgentRuns?: (scene: ModScene) => Promise<readonly ModAgentRun[]>
  /** Localix's own commands and the skills a person runs there (`$.command.list`). */
  listCommands?: (scene: ModScene) => Promise<readonly ModCommandInfo[]>
  /** A conversation's working directory, for its band before it ran a turn here. */
  sessionCwd?: (scene: ModScene) => Promise<string | null>
  /** The scene's conversation for `$.session`, or null outside one. */
  readSession?: (scene: ModScene) => Promise<ModSessionRead | null>
  /** The mods' panes or commands changed: clients re-read them. */
  changed: () => void
  report: (plugin: string, message: string) => void
}

const scenes = new AsyncLocalStorage<ModScene>()

/** Run `work` with `scene` as the place every mods API call in it acts. */
export function inScene<T>(scene: ModScene, work: () => T): T {
  return scenes.run(scene, work)
}

/**
 * A host's dispatch: an event through the chain of the instances `ids`, its `$` calls acting in
 * `scene`; `signal` aborts when the event is abandoned (the run stopped), every `next.signal`.
 */
export const sceneDispatch =
  (engine: {
    dispatch(
      event: string,
      input: unknown,
      core: (event: unknown) => unknown,
      opts: { plugins?: ReadonlySet<string>; origin?: HookOrigin; signal?: AbortSignal },
    ): Promise<unknown>
  }) =>
  (
    event: string,
    input: unknown,
    core: (event: unknown) => unknown,
    scene: ModScene,
    ids?: ReadonlySet<string>,
    origin?: HookOrigin,
    signal?: AbortSignal,
  ) =>
    inScene(scene, () =>
      engine.dispatch(event, input, core, { plugins: ids, origin, ...(signal ? { signal } : {}) }),
    )

/** The scene of the call in hand, else the one the host falls back to. */
export function currentScene(fallback: ModScene): ModScene {
  return scenes.getStore() ?? fallback
}

/** A field a mod passed, as text when it is text: `$` calls take `'key'` or `{ key }`. */
export const stringOr = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

/** Ports for a host with nothing to run: a harness that builds the app without mods. */
export const INERT_MOD_PORTS: ModsPorts = {
  dataDir: () => '',
  workspaceDir: '',
  submitPrompt: async () => {},
  complete: async () => ({
    isAnswered: false,
    reason: 'api-error',
    status: null,
    error: 'unknown',
    usage: NO_USAGE,
  }),
  log: () => {},
  notify: () => {},
  changed: () => {},
  report: () => {},
}
