import type { AgentTool } from '@localixai/agent/agents'
import type { ModScene } from './contracts'
import type { ModsHost } from './host'
import { modTools, wrapToolsWithMods } from './tool-call'

/**
 * The mods of one conversation turn: the events a run fires (`prompt.submit`, `turn.start`,
 * `turn.complete`, `tool.call`) limited to the mods enabled there, in that conversation's scene.
 * Every method is cheap and inert when no enabled mod hooks the event.
 */

export type PromptOutcome =
  | { dropped: true; reason: string }
  | { dropped: false; text: string; context: readonly string[] }

export interface ModRunScope {
  readonly active: boolean
  /** `prompt.submit`: the prompt as the model will read it, notes for it, or a drop. */
  submit(text: string, turnId: string): Promise<PromptOutcome>
  turnStart(text: string, turnId: string): Promise<void>
  /** `turn.complete`: a line a mod shows under the answer, when one does. */
  turnComplete(input: {
    answer: string
    turnId: string
    durationMs: number
    reason: 'answer' | 'aborted' | 'error'
  }): Promise<string | undefined>
  wrapTools(tools: readonly AgentTool[]): AgentTool[]
  /** The tools the enabled mods registered. */
  tools(): AgentTool[]
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

export function createModRunScope(
  host: ModsHost,
  scene: ModScene,
  plugins: ReadonlySet<string>,
): ModRunScope {
  const active = host.loaded().some((plugin) => plugins.has(plugin))
  const scope = { host, scene, plugins }
  return {
    active,
    async submit(text, turnId) {
      if (!active || !host.hears('prompt.submit', plugins))
        return { dropped: false, text, context: [] }
      const input = { text, turnId, wait: false, origin: { kind: 'composer' } }
      const answer = (await host.dispatch(
        'prompt.submit',
        input,
        (e) => ({ text: (e as typeof input).text, context: (e as { context?: unknown }).context }),
        scene,
        plugins,
      )) as { drop?: unknown; text?: unknown; context?: unknown } | undefined
      if (typeof answer?.drop === 'string') return { dropped: true, reason: answer.drop }
      return {
        dropped: false,
        text: typeof answer?.text === 'string' ? answer.text : text,
        context: strings(answer?.context),
      }
    },
    async turnStart(text, turnId) {
      if (active && host.hears('turn.start', plugins))
        await host.dispatch('turn.start', { text, turnId }, () => ({}), scene, plugins)
    },
    async turnComplete(input) {
      if (!active || !host.hears('turn.complete', plugins)) return undefined
      const answer = (await host.dispatch(
        'turn.complete',
        { ...input, isAborted: input.reason === 'aborted' },
        () => ({}),
        scene,
        plugins,
      )) as { text?: unknown } | undefined
      return typeof answer?.text === 'string' && answer.text.trim() ? answer.text : undefined
    },
    wrapTools: (tools) => (active ? wrapToolsWithMods(tools, scope) : [...tools]),
    tools: () => (active ? modTools(scope) : []),
  }
}

/** The scope of a run with no mods: what a host without a mods host gets. */
export const NO_MODS: ModRunScope = {
  active: false,
  submit: async (text) => ({ dropped: false, text, context: [] }),
  turnStart: async () => {},
  turnComplete: async () => undefined,
  wrapTools: (tools) => [...tools],
  tools: () => [],
}
