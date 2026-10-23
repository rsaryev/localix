/**
 * `localix://resource/doc` resource provider — makes recently-extracted documents @-mentionable
 * in the composer. The tree is deliberately FLAT in v1: the roots ARE the recent
 * extractions (newest first, capped by the recents index); expanding one resolves
 * the cached extraction to bounded model-facing Markdown via the same renderer
 * the extraction capability uses, so an @-mention and core read agree byte-for-byte.
 *
 *   localix://resource/doc/<cacheId>   → one extracted document (cacheId = `<hash>.json`)
 */
import {
  buildResourceUri,
  noticeNode,
  providerSegments,
  type ResourceExpansion,
  type ResourceNode,
  type ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
import { renderDocumentForModel } from '@localixai/mini-app-sdk/backend'
import { toDocExtractResult } from './extract-port'
import type { DocumentStore } from './documents/store'
import type { RecentsIndex } from './recents'

const PROVIDER = 'doc'

export interface DocResourceDeps {
  store: DocumentStore
  recents: RecentsIndex
}

export function createDocumentsResourceProvider(deps: DocResourceDeps): ResourceRefProvider {
  return {
    provider: PROVIDER,
    title: 'Documents',

    async listChildren(_userId, parentUri): Promise<ResourceNode[]> {
      // Flat tree: only the roots exist; any child listing is empty.
      if (parentUri !== null) return []
      const recent = await deps.recents.list()
      // An empty index still surfaces the provider — with a hint instead of a
      // silent absence (the menu renders notice rows as non-selectable text).
      if (recent.length === 0) {
        return [
          noticeNode(
            buildResourceUri(PROVIDER),
            'No documents yet',
            'Open or read a document (xlsx/docx/pdf/…) and it will appear here',
          ),
        ]
      }
      return recent.map((entry) => ({
        uri: buildResourceUri(PROVIDER, [entry.id]),
        label: entry.title ?? entry.source,
        detail: [entry.format.toUpperCase(), entry.title ? entry.source : null]
          .filter(Boolean)
          .join(' · '),
        hasChildren: false,
        icon: 'doc',
      }))
    },

    async expand(_userId, uri): Promise<ResourceExpansion> {
      const segments = providerSegments(PROVIDER, uri)
      const id = segments?.length === 1 ? decodeURIComponent(segments[0]) : null
      if (!id) return { ok: false, error: `unknown document: ${uri}` }
      const doc = await deps.store.get(id)
      if (!doc) return { ok: false, error: `unknown document: ${uri}` }
      return {
        ok: true,
        content: renderDocumentForModel(toDocExtractResult(doc)),
        language: 'markdown',
      }
    },
  }
}
