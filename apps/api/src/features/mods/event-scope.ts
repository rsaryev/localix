import type { ModScene } from './contracts'
import type { ModsHost } from './host'
import { answerKey } from './answer-cache'

/**
 * Where a run's mod events go: the conversation's scene and the instances of the mods enabled
 * there. Every event of a run is fired through these helpers, so each one is limited to the run's
 * instances and costs nothing when none of them hooks it.
 */
export interface ModEventScope {
  host: ModsHost
  scene: ModScene
  /** The mod instances of the project where the run happens. */
  plugins: ReadonlySet<string>
}

export const hearsIn = (scope: ModEventScope, event: string): boolean =>
  scope.plugins.size > 0 && scope.host.hears(event, scope.plugins)

export const fireIn = (
  scope: ModEventScope,
  event: string,
  input: unknown,
  core: (event: unknown) => unknown,
): Promise<unknown> => scope.host.dispatch(event, input, core, scope.scene, scope.plugins)

/** An answer kept for the conversation until `$.ui.invalidate(event)` (`answer-cache.ts`). */
export const cachedIn = <T>(
  scope: ModEventScope,
  event: string,
  parts: readonly unknown[],
  compute: () => Promise<T>,
): Promise<T> =>
  scope.host.answers.through(
    event,
    answerKey(scope.scene.sessionId ?? '', [...scope.plugins].sort(), ...parts),
    compute,
  )

/** A field of a hook's answer, when the answer is an object. */
export const fieldOf = (answer: unknown, field: string): unknown =>
  answer && typeof answer === 'object' ? (answer as Record<string, unknown>)[field] : undefined

/** Who provides a core feature, as Claude Code names its own. */
export const ENGINE_PROVIDER = { plugin: 'engine', tier: 'core' } as const
