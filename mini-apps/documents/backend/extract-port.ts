/**
 * The mini app's implementation of the standard `document.extract` capability: maps the
 * documents service's `ExtractedDocument` onto agent-core's narrow
 * `DocumentExtractPort` shape (the seam the core `read`
 * office-fallback consume). Relocated from the chat runtime's boundary adapter —
 * the mapping belongs to whoever OWNS the service, which is now this mini app.
 */
import type {
  DocExtractMetadata,
  DocExtractResult,
  DocumentExtractPort,
} from '@localixai/mini-app-sdk/backend'
import type { DocumentMetadata, ExtractedDocument } from './documents/contracts'
import type { DocumentsService } from './documents/service'

function toMeta(meta: DocumentMetadata): DocExtractMetadata {
  return {
    format: meta.format,
    pageCount: meta.pageCount,
    slideCount: meta.slideCount,
    sheetNames: meta.sheetNames,
    sheetName: meta.sheetName,
    title: meta.title,
    author: meta.author,
    truncated: meta.truncated,
  }
}

/** Map the service's `ExtractedDocument` to the agent-core port's local shape. */
export function toDocExtractResult(doc: ExtractedDocument): DocExtractResult {
  if (doc.kind === 'table') {
    return {
      kind: 'table',
      columns: doc.columns.map((c) => c.title),
      // Row objects are keyed by column id; flatten to positional cells for the preview.
      rows: doc.rows.map((row) => doc.columns.map((c) => row[c.id] ?? null)),
      metadata: toMeta(doc.metadata),
    }
  }
  return { kind: doc.kind, markdown: doc.markdown, metadata: toMeta(doc.metadata) }
}

/** The narrow port contributed as the `document.extract` capability. */
export function buildDocumentExtractPort(documentsService: DocumentsService): DocumentExtractPort {
  return {
    extract: async (params) => {
      const res = await documentsService.extract({
        path: params.path,
        options: { pageRange: params.pageRange, sheet: params.sheet, offset: params.offset },
      })
      return toDocExtractResult(res.document)
    },
  }
}
