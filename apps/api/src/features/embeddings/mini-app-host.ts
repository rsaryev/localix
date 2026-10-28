/**
 * `host.semantic` for one mini app: the semantic index, confined to the mini app's own collections.
 *
 * Every collection name a mini app passes is rewritten to `mini-app:<app>:<name>`, on the way in
 * (sources, change notices, queries) — so a mini app can neither read nor overwrite chat's vectors
 * or another mini app's, and two mini apps may both call a collection `cards`.
 */
import type { SemanticIndexHost, SemanticSource } from '@localixai/mini-app-sdk/backend'
import { createOwnedRegistrations, type OwnedRegistrations } from '../../lib/owned-registrations'
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
  /** What each mini app holds: a reloaded backend replaces its own source instead of colliding. */
  registrations: OwnedRegistrations = createOwnedRegistrations(),
): SemanticIndexHost {
  const own = (collection: string) => miniAppCollection(miniAppName, collection)
  // Vectors on demand carry no collection: the same port every core consumer uses.
  const { vectors } = service
  return {
    status() {
      const note = service.strategy()
      const model = service.model()
      return {
        ready: note.mode === 'hybrid',
        model: { id: model.id, label: model.label, dimensions: model.indexDimensions },
      }
    },
    registerSource(source: SemanticSource) {
      const collection = own(source.collection)
      // The same mini app registering the collection again is its backend being loaded again: the
      // index keeps ONE registration and this load's closures answer through it. Which load answers
      // is the backend host's verdict (`settle`), so a duplicate it discards never displaces the
      // wired backend. Another mini app's collection is a different name and never collides.
      return registrations.bind(miniAppName, `semantic:${collection}`, source, (current) =>
        service.registerSource({
          collection,
          // A mini app's category is named by its source, else by its own collection name.
          label: source.label ?? source.collection,
          get version() {
            return current().version
          },
          scan: (cursor, limit) => current().scan(cursor, limit),
          read: (keys) => current().read(keys),
          ...(source.count ? { count: () => current().count?.() ?? Promise.resolve(0) } : {}),
        }),
      ).dispose
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
