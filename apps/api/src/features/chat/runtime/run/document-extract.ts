/**
 * Boundary adapter for the `read` tool's office/PDF fallback: wraps the
 * standard `document.extract` capability into the text-extractor callback shape.
 * Core sees only the SDK port and never the provider implementation.
 */
import {
  renderDocumentForModel,
  type DocumentExtractPort,
  type DocumentTextExtractor,
} from '../../../agent-core/tools/file/document-ports'

/**
 * The `read` tool's extractor callback: an office/PDF path → bounded model-facing
 * text, or null when extraction fails (so `read` falls back to its binary notice).
 */
export function buildDocumentTextExtractor(port: DocumentExtractPort): DocumentTextExtractor {
  return async (targetPath, offset, window) => {
    try {
      const result = await port.extract({ path: targetPath, offset, ...window })
      return renderDocumentForModel(result, offset ?? 0)
    } catch {
      return null
    }
  }
}
