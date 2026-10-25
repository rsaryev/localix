import type { OptionVaultPort } from '../features/ext/option-vault'
import type { SecretsStore } from '../features/secrets/store-contracts'

/** Who an option belongs to, read from its key: each kind's options have their own prefix. */
function consumerOf(key: string): {
  type: 'plugin' | 'mini-app' | 'mcp-server'
  noun: string
  actor: string
  /** What the vault records as the origin of the item. */
  origin: 'plugin' | 'mini-app' | 'system'
} {
  if (key.startsWith('mini-app-option.'))
    return { type: 'mini-app', noun: 'mini app', actor: 'mini-apps', origin: 'mini-app' }
  if (key.startsWith('mcp-option.'))
    return { type: 'mcp-server', noun: 'MCP server', actor: 'mcp', origin: 'system' }
  return { type: 'plugin', noun: 'plugin', actor: 'plugins', origin: 'plugin' }
}

/**
 * The vault, as extension options use it (`features/ext/option-vault.ts`): one managed item per
 * sensitive option, bound to the plugin or mini app it belongs to so the vault can say what uses
 * it, and every value it hands out remembered by the exposure shield, as the other vault readers
 * do. A plugin's options and a mini app's are separate items under separate consumers.
 */
export function optionVaultPortOf(
  store: Pick<SecretsStore, 'set' | 'bind' | 'resolve' | 'list' | 'delete'>,
  shield: { remember(userId: string, value: string): void },
): OptionVaultPort {
  const audit = (key: string, owner: string) => ({
    actorType: 'system' as const,
    actorId: consumerOf(key).actor,
    consumerType: consumerOf(key).type,
    consumerId: owner,
  })
  return {
    async store(userId, key, value, owner) {
      const consumer = consumerOf(key)
      await store.set(userId, key, value, {
        label: `${owner} option ${key.split('.').at(-1)}`,
        type: 'secret',
        source: consumer.origin,
        tags: [consumer.type, owner],
        audit: audit(key, owner),
      })
      await store.bind(userId, key, {
        consumerType: consumer.type,
        consumerId: owner,
        field: key,
        label: `${owner} ${consumer.noun} option`,
      })
      shield.remember(userId, value)
    },
    async resolve(userId, key, owner) {
      const value = await store.resolve(userId, key, audit(key, owner))
      if (value) shield.remember(userId, value)
      return value
    },
    async versions(userId, prefix) {
      const items = await store.list(userId)
      return new Map(
        items.filter((item) => item.key.startsWith(prefix)).map((item) => [item.key, item.version]),
      )
    },
    async remove(userId, key) {
      await store.delete(userId, key)
    },
  }
}
