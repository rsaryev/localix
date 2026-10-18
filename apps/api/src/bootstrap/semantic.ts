/**
 * Composition of semantic search: the store, the service (engine + indexer), the core sources it
 * indexes and the embedding models it can be set to — this computer's, or a connected provider's. Needs only the database, so it is built right after infra and handed
 * to every consumer — plugin hosts (`host.semantic`), global search (its strategy) and the
 * routes. Nothing starts here: `boot()` runs post-listen, when spawning a process is safe.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { createSemanticService } from '../features/embeddings/service'
import { createSemanticStore } from '../features/embeddings/store'
import {
  createMessagesSemanticSource,
  createSessionsSemanticSource,
} from '../features/chat/semantic-sources'
import { embeddingCatalogSource } from '../features/embeddings/catalog-source'
import { PROVIDER_EMBEDDINGS } from '../features/embeddings/provider-embeddings'
import type { CatalogService } from '../features/catalog/service'
import { firstEnabledKey } from '../features/chat/runtime/provider-keys'
import type { LocalModelsService } from '../features/local-models/service'
import type { ProviderConnectionsService } from '../features/provider-connections/service'
import type { createLogger } from '../lib/logger'

/**
 * The keys `userId` connected embedding-capable providers with: an API key, or a sign-in's token
 * where that is an ordinary key (OpenRouter). A subscription sign-in (ChatGPT) is left out.
 */
function providerKeysOf(
  connections: ProviderConnectionsService,
  log: (event: string, fields: Record<string, unknown>) => void,
) {
  const embeddable = new Map(PROVIDER_EMBEDDINGS.map((p) => [p.providerId, p]))
  return async (userId: string): Promise<Map<string, string>> => {
    const keys = new Map<string, string>()
    const { connections: rows } = await connections.listConnections(userId)
    for (const row of rows) {
      if (!embeddable.has(row.providerId) || keys.has(row.providerId)) continue
      // One connection that cannot be read (a vault item gone) costs only its own provider.
      try {
        const record = await connections.requireConnection(userId, row.id)
        const key = firstEnabledKey(record.keys)
        const usable =
          key?.authType === 'api-key' ||
          (key?.authType === 'oauth' && embeddable.get(row.providerId)?.signInWorks)
        if (key && usable && key.apiKey) keys.set(row.providerId, key.apiKey)
        else
          log('semantic.provider_key_missing', {
            provider: row.providerId,
            auth: key?.authType ?? null,
          })
      } catch (err) {
        log('semantic.provider_key_unreadable', { provider: row.providerId, error: String(err) })
      }
    }
    return keys
  }
}

export function buildSemanticService(deps: {
  db: Kysely<AppDatabase>
  logger: ReturnType<typeof createLogger>
  /** Downloads, files and the server process of a local embedding model. */
  localModels: LocalModelsService
  /** The keys a provider's embedding model runs with. */
  providerConnectionsService: ProviderConnectionsService
  /** Where the embedding models are listed, beside chat models. */
  catalogService: Pick<CatalogService, 'registerModelSource'>
  /** `LOCALIX_DEFAULT_USER_ID`: this computer's owner, whose connections list cloud models. */
  env: { LOCALIX_DEFAULT_USER_ID: string }
}) {
  const service = createSemanticService({
    store: createSemanticStore(deps.db),
    localModels: deps.localModels,
    providerKeys: providerKeysOf(deps.providerConnectionsService, (event, fields) =>
      deps.logger.info({ event, ...fields }),
    ),
    log: (event, fields) => deps.logger.info({ event, ...fields }),
  })
  service.registerSource(createMessagesSemanticSource(deps.db))
  service.registerSource(createSessionsSemanticSource(deps.db))
  const owner = deps.env.LOCALIX_DEFAULT_USER_ID
  deps.catalogService.registerModelSource(embeddingCatalogSource(() => service.models(owner)))
  return service
}
