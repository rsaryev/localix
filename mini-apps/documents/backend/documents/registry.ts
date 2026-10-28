/**
 * Format → driver registry. Maps a {@link DocumentFormat} to its {@link DocumentConverter}
 * and detects the format from a file extension or media type. The driver FACTORIES are
 * cheap (no heavy imports at module load); each driver pulls its parsing lib in lazily.
 */
import type { DocumentConverter, DocumentFormat } from './contracts'
import { DocumentError } from './errors'
import { createDocxConverter } from './drivers/docx'
import { createDocConverter } from './drivers/doc'
import { createXlsxConverter } from './drivers/xlsx'
import { createCsvConverter } from './drivers/csv'
import { createMarkdownConverter } from './drivers/md'
import { createPptxConverter } from './drivers/pptx'
import { createOdtConverter } from './drivers/odt'
import { createPdfConverter } from './drivers/pdf'

/** Canonical media type per format (OOXML / ODF / PDF / text). */
export const DOCUMENT_MEDIA_TYPES: Record<DocumentFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  odt: 'application/vnd.oasis.opendocument.text',
  csv: 'text/csv',
  md: 'text/markdown',
}

/** Extension (without dot, lowercased) → format. */
const EXT_TO_FORMAT: Record<string, DocumentFormat> = {
  docx: 'docx',
  // Legacy Word 97–2003 binary — its own driver (word-extractor).
  doc: 'doc',
  pptx: 'pptx',
  xlsx: 'xlsx',
  // Legacy/variant Excel — SheetJS reads BIFF (.xls) and macro/binary workbooks
  // (.xlsm/.xlsb) through the same xlsx driver.
  xls: 'xlsx',
  xlsm: 'xlsx',
  xlsb: 'xlsx',
  pdf: 'pdf',
  odt: 'odt',
  csv: 'csv',
  md: 'md',
  markdown: 'md',
  mdx: 'md',
}

/** Media type (lowercased, params stripped) → format. */
const MEDIA_TYPE_TO_FORMAT: Record<string, DocumentFormat> = {
  [DOCUMENT_MEDIA_TYPES.docx]: 'docx',
  [DOCUMENT_MEDIA_TYPES.pptx]: 'pptx',
  [DOCUMENT_MEDIA_TYPES.xlsx]: 'xlsx',
  [DOCUMENT_MEDIA_TYPES.pdf]: 'pdf',
  [DOCUMENT_MEDIA_TYPES.odt]: 'odt',
  [DOCUMENT_MEDIA_TYPES.doc]: 'doc',
  'application/vnd.ms-excel': 'xlsx',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
}

/** Detect a format from a file name/path extension. */
export function formatFromExtension(pathOrName: string): DocumentFormat | undefined {
  const dot = pathOrName.lastIndexOf('.')
  if (dot < 0) return undefined
  const ext = pathOrName.slice(dot + 1).toLowerCase()
  return EXT_TO_FORMAT[ext]
}

/** Detect a format from a media type (params + case ignored). */
export function formatFromMediaType(mediaType: string): DocumentFormat | undefined {
  const bare = mediaType.split(';')[0]!.trim().toLowerCase()
  return MEDIA_TYPE_TO_FORMAT[bare]
}

/** Detect a format from a path and/or a media type (path wins). */
export function detectFormat(hint: {
  path?: string
  mediaType?: string
}): DocumentFormat | undefined {
  return (
    (hint.path ? formatFromExtension(hint.path) : undefined) ??
    (hint.mediaType ? formatFromMediaType(hint.mediaType) : undefined)
  )
}

const FACTORIES: Record<DocumentFormat, () => DocumentConverter> = {
  docx: createDocxConverter,
  doc: createDocConverter,
  pptx: createPptxConverter,
  xlsx: createXlsxConverter,
  pdf: createPdfConverter,
  odt: createOdtConverter,
  csv: createCsvConverter,
  md: createMarkdownConverter,
}

/** Build the converter for a format (throws `unsupported_format` for anything unknown). */
export function converterForFormat(format: DocumentFormat): DocumentConverter {
  const make = FACTORIES[format]
  if (!make) throw new DocumentError('unsupported_format', `No driver for format "${format}"`)
  return make()
}
