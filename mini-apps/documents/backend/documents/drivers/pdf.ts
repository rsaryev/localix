/**
 * PDF driver — extracted-text fallback (kind `text`) via officeparser. A PDF may
 * also be sent to a vision model natively (see the service's native-vs-extracted
 * helper); this driver is the text path for models without PDF support, and for
 * cheap text search. `options.pageRange` narrows to a 1-based page window.
 */
import type { DocumentConverter, DocumentInput, ExtractedTextDocument } from '../contracts'
import { extractViaOfficeParser } from './officeparser-extract'

export function createPdfConverter(): DocumentConverter {
  return {
    extract(input: DocumentInput): Promise<ExtractedTextDocument> {
      return extractViaOfficeParser({
        bytes: input.bytes,
        format: 'pdf',
        kind: 'text',
        mediaType: input.mediaType,
        options: input.options,
      })
    },
  }
}
