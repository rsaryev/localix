/**
 * PPTX driver — PowerPoint decks to Markdown (kind `slides`) via officeparser.
 * `options.pageRange` narrows to a 1-based slide window.
 */
import type { DocumentConverter, DocumentInput, ExtractedTextDocument } from '../contracts'
import { extractViaOfficeParser } from './officeparser-extract'

export function createPptxConverter(): DocumentConverter {
  return {
    extract(input: DocumentInput): Promise<ExtractedTextDocument> {
      return extractViaOfficeParser({
        bytes: input.bytes,
        format: 'pptx',
        kind: 'slides',
        mediaType: input.mediaType,
        options: input.options,
      })
    },
  }
}
