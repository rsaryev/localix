import { firstEnabledKey } from './provider-keys'

/**
 * The catalog models this person can run: those whose provider has a connection with an enabled
 * key. What a `model:` alias (an agent file's, a hook's) may route to; the catalog itself lists
 * every provider's models, and routing to one never connected fails the run that asked.
 */
export function offeredModelIds(
  models: readonly { id: string; providerId: string }[],
  connections: readonly {
    providerId: string
    keys: readonly { enabled: boolean; priority: number }[]
  }[],
): string[] {
  const keyed = new Set(connections.filter((c) => firstEnabledKey(c.keys)).map((c) => c.providerId))
  return models.filter((model) => keyed.has(model.providerId)).map((model) => model.id)
}
