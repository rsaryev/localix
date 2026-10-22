import type { PluginConfigVault } from '../features/plugins/config-vault'
import type { SecretsStore } from '../features/secrets/store-contracts'

/**
 * The vault, as plugin options use it (`features/plugins/config-vault.ts`): one managed item per
 * sensitive option, bound to its plugin so the vault can say what uses it, and every value it
 * hands out remembered by the exposure shield, as the other vault readers do.
 */
export function pluginConfigVaultOf(
  store: Pick<SecretsStore, 'set' | 'bind' | 'resolve' | 'list' | 'delete'>,
  shield: { remember(userId: string, value: string): void },
): PluginConfigVault {
  const audit = (pluginName: string) => ({
    actorType: 'system' as const,
    actorId: 'plugins',
    consumerType: 'plugin',
    consumerId: pluginName,
  })
  return {
    async store(userId, key, value, pluginName) {
      await store.set(userId, key, value, {
        label: `${pluginName} option ${key.split('.').at(-1)}`,
        type: 'secret',
        source: 'plugin',
        tags: ['plugin', pluginName],
        audit: audit(pluginName),
      })
      await store.bind(userId, key, {
        consumerType: 'plugin',
        consumerId: pluginName,
        field: key,
        label: `${pluginName} plugin option`,
      })
      shield.remember(userId, value)
    },
    async resolve(userId, key, pluginName) {
      const value = await store.resolve(userId, key, audit(pluginName))
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
