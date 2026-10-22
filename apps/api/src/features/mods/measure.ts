import type { ModScene, ModSessionRead } from './contracts'

/**
 * `session.measure`: after each turn, the conversation's usage — the context window's fill and
 * what it has cost — pushed to the mods when a unit moved since the last measure, as Claude Code
 * pushes it instead of having mods poll `$.session.usage()`. Localix keeps no rate-limit windows.
 */

type Dispatch = (
  event: string,
  input: unknown,
  core: (event: unknown) => unknown,
  scene: ModScene,
  ids?: ReadonlySet<string>,
) => Promise<unknown>

interface Measured {
  tokens?: number
  costUsd?: number
}

export function createMeasurer(input: {
  read?: (scene: ModScene) => Promise<ModSessionRead | null>
  dispatch: Dispatch
  hears: (event: string, ids: ReadonlySet<string>) => boolean
}) {
  const last = new Map<string, Measured>()
  return async function measure(scene: ModScene, ids: ReadonlySet<string>): Promise<void> {
    if (!scene.sessionId || !input.read || !input.hears('session.measure', ids)) return
    const session = await input.read(scene)
    if (!session?.context && session?.costUsd === undefined) return
    const before = last.get(scene.sessionId)
    const now = { tokens: session.context?.tokens, costUsd: session.costUsd }
    const changed = [
      ...(session.context && now.tokens !== before?.tokens ? ['context'] : []),
      ...(now.costUsd !== undefined && now.costUsd !== before?.costUsd ? ['cost'] : []),
    ]
    last.set(scene.sessionId, now)
    if (changed.length === 0) return
    const context = session.context
    await input.dispatch(
      'session.measure',
      {
        context: {
          window: context?.window ?? 0,
          ...(context?.tokens !== undefined ? { tokens: context.tokens } : {}),
          ...(context?.tokens !== undefined && context.window > 0
            ? { percent: Math.round((context.tokens / context.window) * 100) }
            : {}),
        },
        rateLimits: [],
        ...(now.costUsd !== undefined ? { cost: { usd: now.costUsd } } : {}),
        changed,
      },
      () => ({ changed }),
      scene,
      ids,
    )
  }
}
