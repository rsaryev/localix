/**
 * DOC driver — legacy Word 97–2003 binary documents to plain text (kind `text`)
 * via `word-extractor` (the format is frozen, so the lib's age is a feature).
 * No structure survives the binary format's text stream, so the "markdown" is
 * honest plain text: body first, then any footnotes/endnotes.
 */
/// <reference path="./vendor.d.ts" />
import type { DocumentConverter, DocumentInput, ExtractedTextDocument } from '../contracts'
import type WordExtractorType from 'word-extractor'

/** CommonJS/ESM interop: unwrap a `default` when the lib is `export =`. */
function unwrap(mod: unknown): typeof WordExtractorType {
  const m = mod as { default?: unknown }
  return (m?.default ?? mod) as typeof WordExtractorType
}

export function createDocConverter(): DocumentConverter {
  return {
    async extract(input: DocumentInput): Promise<ExtractedTextDocument> {
      const WordExtractor = unwrap(await import('word-extractor'))
      const doc = await new WordExtractor().extract(Buffer.from(input.bytes))
      const parts = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()]
        .map((s) => s?.trim() ?? '')
        .filter(Boolean)
      return {
        kind: 'text',
        markdown: parts.join('\n\n'),
        metadata: { format: 'doc', sourceMediaType: input.mediaType },
      }
    },
  }
}
