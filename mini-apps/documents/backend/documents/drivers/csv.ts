/**
 * CSV driver — delimited text to a dataview table. No heavy lib: reuses the
 * dependency-free RFC-4180-ish parser + column inference already shipped in
 * `@localixai/dataview`, so a CSV extraction shapes identically to an xlsx one.
 */
import { tableFromDelimited } from '@localixai/dataview'
import type { DocumentConverter, DocumentInput, ExtractedTableDocument } from '../contracts'

export function createCsvConverter(): DocumentConverter {
  return {
    async extract(input: DocumentInput): Promise<ExtractedTableDocument> {
      const text = input.bytes.toString('utf8')
      const { columns, rows } = tableFromDelimited(text, { delimiter: ',', header: true })
      return {
        kind: 'table',
        columns,
        rows,
        metadata: { format: 'csv', sourceMediaType: input.mediaType },
      }
    },
  }
}
