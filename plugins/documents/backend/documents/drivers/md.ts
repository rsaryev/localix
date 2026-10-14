/**
 * Markdown / plain-text driver — trivial: the bytes ARE the Markdown. Decoded as
 * UTF-8 and returned verbatim as a `text` extraction (the service handles caps +
 * character windowing). No lib.
 */
import type { DocumentConverter, DocumentInput, ExtractedTextDocument } from '../contracts'

export function createMarkdownConverter(): DocumentConverter {
  return {
    async extract(input: DocumentInput): Promise<ExtractedTextDocument> {
      return {
        kind: 'text',
        markdown: input.bytes.toString('utf8'),
        metadata: { format: 'md', sourceMediaType: input.mediaType },
      }
    },
  }
}
