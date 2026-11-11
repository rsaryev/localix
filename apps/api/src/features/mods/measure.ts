import type { ModScene, ModSessionRead } from './contracts'
import { contextUsage } from '../plugins/kit'
import { fireIn, hearsIn, type ModEventScope } from './event-scope'

/**
 * `session.measure`: after each turn, the conversation's usage — the context window's fill and
 * what it has cost — pushed to the mods when a unit moved since the last measure, as Claude Code
 * pushes it instead of having mods poll `$.session.usage()`. Localix keeps no rate-limit windows.
 */

interface Measured {
  tokens?: number
  costUsd?: number
}

export function createMeasurer(input: {
  read?: (scene: ModScene) => Promise<ModSessionRead | null>
}) {
  const last = new Map<string, Measured>()
  return async function measure(scope: Pick<ModEventScope, 'kit' | 'scene'>): Promise<void> {
    const { scene } = scope
    if (!scene.sessionId || !input.read || !hearsIn(scope, 'session.measure')) return
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
    await fireIn(
      scope,
      'session.measure',
      {
        context: contextUsage({ window: context?.window ?? 0, tokens: context?.tokens }),
        rateLimits: [],
        ...(now.costUsd !== undefined ? { cost: { usd: now.costUsd } } : {}),
        changed,
      },
      () => ({ changed }),
    )
  }
}
