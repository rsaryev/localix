/**
 * ODT driver — OpenDocument text to Markdown (kind `text`) via officeparser.
 */
import type { DocumentConverter, DocumentInput, ExtractedTextDocument } from '../contracts'
import { extractViaOfficeParser } from './officeparser-extract'

export function createOdtConverter(): DocumentConverter {
  return {
    extract(input: DocumentInput): Promise<ExtractedTextDocument> {
      return extractViaOfficeParser({
        bytes: input.bytes,
        format: 'odt',
        kind: 'text',
        mediaType: input.mediaType,
        options: input.options,
      })
    },
  }
}
