import type { ModsHost as KitModsHost } from '@rsaryev/llx-plugin/mods'
import type { ModScene } from './contracts'
import type { ModsHost } from './host'
import { answerKey } from './answer-cache'

/**
 * Where a run's mod events go: the conversation's scene and the kit's mods host that runs its mods
 * (`session/session-host.ts`). Every event of a run is fired through these helpers, so each costs
 * nothing when no loaded mod hooks it.
 */
export interface ModEventScope {
  host: ModsHost
  /** The conversation's mods host: its chain, its `$`, its interface. */
  kit: KitModsHost
  scene: ModScene
  /** A delegated child's run: its session id, the `agentId` its turn and tool events carry. */
  agentId?: string
}

/** `{ agentId }` for a delegated child's event, nothing for the main conversation's. */
export const agentOf = (scope: { agentId?: string }) =>
  scope.agentId ? { agentId: scope.agentId } : {}

export const hearsIn = (scope: Pick<ModEventScope, 'kit'>, event: string): boolean =>
  scope.kit.chain.hears(event)

/** The kit's `fire` by an event's name alone: Localix builds each event's input itself. */
type FireByName = (
  name: string,
  input: unknown,
  options: { core: (e: unknown) => Promise<unknown>; signal?: AbortSignal },
) => Promise<unknown>

/**
 * The event through the conversation's chain; `core` is Localix's own behaviour at its end. An
 * event abandoned before its end (the turn stopped) runs nothing of Localix's: the kit skips a hook
 * that failed and goes on to core, and a hook that held a tool call fails as the turn stops.
 */
export const fireIn = (
  scope: Pick<ModEventScope, 'kit'>,
  event: string,
  input: unknown,
  core: (event: unknown) => unknown,
  signal?: AbortSignal,
): Promise<unknown> =>
  (scope.kit.fire as unknown as FireByName)(event, input, {
    core: async (e) => {
      signal?.throwIfAborted()
      return core(e)
    },
    ...(signal ? { signal } : {}),
  })

/** An answer kept for the conversation until `$.ui.invalidate(event)` (`answer-cache.ts`). */
export const cachedIn = <T>(
  scope: ModEventScope,
  event: string,
  parts: readonly unknown[],
  compute: () => Promise<T>,
): Promise<T> =>
  scope.host.answers.through(
    event,
    answerKey(
      scope.scene.sessionId ?? '',
      scope.kit.active().map((mod) => mod.name),
      ...parts,
    ),
    compute,
  )

/** A field of a hook's answer, when the answer is an object. */
export const fieldOf = (answer: unknown, field: string): unknown =>
  answer && typeof answer === 'object' ? (answer as Record<string, unknown>)[field] : undefined

/** Who provides a core feature, as Claude Code names its own. */
export const ENGINE_PROVIDER = { plugin: 'engine', tier: 'core' } as const
