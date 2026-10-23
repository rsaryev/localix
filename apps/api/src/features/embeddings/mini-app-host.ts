/**
 * `host.semantic` for one mini app: the semantic index, confined to the mini app's own collections.
 *
 * Every collection name a mini app passes is rewritten to `mini-app:<app>:<name>`, on the way in
 * (sources, change notices, queries) — so a mini app can neither read nor overwrite chat's vectors
 * or another mini app's, and two mini apps may both call a collection `cards`.
 */
import type { SemanticIndexHost, SemanticSource } from '@localixai/mini-app-sdk/backend'
import type { SemanticService } from './service'

const COLLECTION_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function miniAppCollection(miniAppName: string, collection: string): string {
  if (!COLLECTION_NAME.test(collection)) {
    throw new Error(
      `invalid semantic collection name "${collection}" (lowercase letters, digits, . _ -)`,
    )
  }
  return `mini-app:${miniAppName}:${collection}`
}

export function createMiniAppSemanticHost(
  service: SemanticService,
  miniAppName: string,
): SemanticIndexHost {
  const own = (collection: string) => miniAppCollection(miniAppName, collection)
  // Vectors on demand carry no collection: the same port every core consumer uses.
  const { vectors } = service
  return {
    status() {
      const note = service.strategy()
      const model = service.model()
      // Always on: `enabled` stays in the mini app contract, true; `ready` says when it embeds.
      return {
        enabled: true,
        ready: note.mode === 'hybrid',
        model: { id: model.id, label: model.label, dimensions: model.indexDimensions },
      }
    },
    registerSource(source: SemanticSource) {
      return service.registerSource({
        collection: own(source.collection),
        // A mini app's category is named by its source, else by its own collection name.
        label: source.label ?? source.collection,
        version: source.version,
        scan: (cursor, limit) => source.scan(cursor, limit),
        read: (keys) => source.read(keys),
        ...(source.count ? { count: () => source.count!() } : {}),
      })
    },
    changed(collection, keys) {
      void service.changed(own(collection), keys)
    },
    query(userId, collection, text, options) {
      if (service.strategy().mode !== 'hybrid') return Promise.resolve([])
      return service.reader.query(userId, own(collection), text, options)
    },
    embed: (texts, options) => vectors.embed(texts, options),
    rank: (query, candidates, options) => vectors.rank(query, candidates, options),
  }
}
