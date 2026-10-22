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
}

export type ModelCompletion =
  | { isAnswered: true; text: string }
  | { isAnswered: false; reason: string }

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
  /** The mods' panes or commands changed: clients re-read them. */
  changed(): void
  report(plugin: string, message: string): void
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
