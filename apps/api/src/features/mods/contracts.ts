import { AsyncLocalStorage } from 'node:async_hooks'

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
  prompt: string
  system?: string
  maxTokens?: number
  signal?: AbortSignal
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

export type ModelCompletion =
  | { isAnswered: true; text: string; usage?: ModelUsage }
  | { isAnswered: false; reason: string }

/** One message of a conversation as Claude Code's `$.session.messages()` gives it. */
export interface ModSessionMessage {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool_use_id: string; tool: string; input: Record<string, unknown> }[]
  toolResults?: { tool_use_id: string; text: string; isError: boolean }[]
}

/** What a conversation holds for `$.session`; a figure Localix does not have is left out. */
export interface ModSessionRead {
  messages: ModSessionMessage[]
  model: string | null
  /** The live context window: the tokens in it, when measured, and its size. */
  context?: { tokens?: number; window: number }
  /** What the conversation has cost so far, in US dollars. */
  costUsd?: number
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
  complete: async () => ({ isAnswered: false, reason: 'no mods host' }),
  log: () => {},
  notify: () => {},
  changed: () => {},
  report: () => {},
}
