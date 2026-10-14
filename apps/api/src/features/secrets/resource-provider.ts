import type {
  ResourceExpansion,
  ResourceNode,
  ResourceRefProvider,
} from '../agent-core/resource-refs/provider'
import {
  decodeResourceSegment,
  buildResourceUri,
  linkAction,
  providerSegments,
} from '../agent-core/resource-refs/provider'
import { RESOURCE_PROVIDERS } from '../agent-core/resource-refs/providers'
import type { SecretMeta } from './contracts'

const PROVIDER = RESOURCE_PROVIDERS.vault
const ITEMS_SEGMENT = 'items'

export const vaultItemResourceUri = (key: string): string =>
  buildResourceUri(PROVIDER, [ITEMS_SEGMENT, key])

const keyFromVaultUri = (uri: string): string | null => {
  const segments = providerSegments(PROVIDER, uri)
  if (segments?.length !== 2 || segments[0] !== ITEMS_SEGMENT || !segments[1]) {
    return null
  }
  return decodeResourceSegment(segments[1])
}

const metadataExpansion = (item: SecretMeta): ResourceExpansion => ({
  ok: true,
  language: 'json',
  content: JSON.stringify(
    {
      kind: 'vault_item_metadata',
      title: item.label,
      description: item.description ?? '',
      alias: item.key,
      type: item.type,
      source: item.source,
      tags: item.tags,
      version: item.version,
      reference: item.reference,
      valueAccess: 'server-side trusted tools only',
      modelCanReadValue: false,
    },
    null,
    2,
  ),
})

/**
 * Makes Vault items linkable through the shared `@resource` tree. Both browse
 * rows and expansions are metadata-only; this provider has no resolver port and
 * therefore cannot accidentally decrypt a value.
 */
export function createVaultResourceProvider(options: {
  listItems: (userId: string) => Promise<SecretMeta[]>
}): ResourceRefProvider {
  return {
    provider: PROVIDER,
    title: 'Vault',

    async listChildren(userId, parentUri, query) {
      if (parentUri !== null) return []
      const needle = query?.trim().toLocaleLowerCase()
      return (await options.listItems(userId)).flatMap((item): ResourceNode[] => {
        const matches =
          !needle ||
          `${item.label} ${item.key} ${item.description ?? ''} ${item.type} ${item.tags.join(' ')}`
            .toLocaleLowerCase()
            .includes(needle)
        return matches
          ? [
              {
                uri: vaultItemResourceUri(item.key),
                label: item.label,
                detail: `${item.type} · ${item.key}`,
                hasChildren: false,
                icon: 'key',
                actions: linkAction('Link this Vault item'),
              },
            ]
          : []
      })
    },

    async expand(userId, uri) {
      const key = keyFromVaultUri(uri)
      if (!key) return { ok: false, error: 'not a Vault item resource' }
      const item = (await options.listItems(userId)).find((candidate) => candidate.key === key)
      return item ? metadataExpansion(item) : { ok: false, error: 'Vault item not found' }
    },
  }
}
