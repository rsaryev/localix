/**
 * Composition of semantic search: the store, the service (engine + indexer) and the core sources
 * it indexes. Needs only the database, so it is built right after infra and handed to every
 * consumer — plugin hosts (`host.semantic`), global search (its strategy) and the routes.
 * Nothing starts here: `boot()` runs post-listen, when spawning a process is safe.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { createSemanticService } from '../features/embeddings/service'
import { createSemanticStore } from '../features/embeddings/store'
import {
  createMessagesSemanticSource,
  createSessionsSemanticSource,
} from '../features/chat/semantic-sources'
import type { SemanticService } from '../features/embeddings/service'
import type { LocalModelsService } from '../features/local-models/service'
import type { createLogger } from '../lib/logger'

export function buildSemanticService(deps: {
  db: Kysely<AppDatabase>
  logger: ReturnType<typeof createLogger>
  /** Downloads, files and the server process of the embedding model. */
  localModels: LocalModelsService
}) {
  const service = createSemanticService({
    store: createSemanticStore(deps.db),
    localModels: deps.localModels,
    log: (event, fields) => deps.logger.info({ event, ...fields }),
  })
  service.registerSource(createMessagesSemanticSource(deps.db))
  service.registerSource(createSessionsSemanticSource(deps.db))
  return service
}

/** Group routing's embedding model: classification vectors from search's engine, the moment it
 * can run; null until then (downloading, failed). */
export function routingEmbedderOf(service: Pick<SemanticService, 'engine'>) {
  return () => {
    const engine = service.engine()
    return engine ? (text: string) => engine.embedQuery(text, 'classification') : null
  }
}
