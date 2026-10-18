/**
 * `host.semantic` for one plugin: the semantic index, confined to the plugin's own collections.
 *
 * Every collection name a plugin passes is rewritten to `plugin:<plugin>:<name>`, on the way in
 * (sources, change notices, queries) — so a plugin can neither read nor overwrite chat's vectors
 * or another plugin's, and two plugins may both call a collection `cards`.
 */
import type { SemanticIndexHost, SemanticSource } from '@localixai/plugin-sdk/backend'
import type { SemanticService } from './service'

const COLLECTION_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function pluginCollection(pluginName: string, collection: string): string {
  if (!COLLECTION_NAME.test(collection)) {
    throw new Error(
      `invalid semantic collection name "${collection}" (lowercase letters, digits, . _ -)`,
    )
  }
  return `plugin:${pluginName}:${collection}`
}

export function createPluginSemanticHost(
  service: SemanticService,
  pluginName: string,
): SemanticIndexHost {
  const own = (collection: string) => pluginCollection(pluginName, collection)
  return {
    status() {
      const note = service.strategy()
      const model = service.model()
      return {
        enabled: service.enabled(),
        ready: note.mode === 'hybrid',
        model: service.enabled()
          ? { id: model.id, label: model.label, dimensions: model.indexDimensions }
          : null,
      }
    },
    registerSource(source: SemanticSource) {
      return service.registerSource({
        collection: own(source.collection),
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
    async embed(texts, options) {
      const engine = service.strategy().mode === 'hybrid' ? service.engine() : null
      if (!engine) return null
      const task = options.task ?? 'search'
      const vectors =
        options.role === 'query'
          ? await Promise.all(texts.map((t) => engine.embedQuery(t, task)))
          : await engine.embedDocuments(texts.map((text) => ({ text, task })))
      return { model: engine.fingerprint, dimensions: engine.model.indexDimensions, vectors }
    },
  }
}
