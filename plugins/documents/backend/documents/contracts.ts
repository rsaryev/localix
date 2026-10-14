import { z } from 'zod'
import type { TableColumn, TableRow } from '@localixai/dataview'

/**
 * Source file formats the registry can route to a driver. `text`-producing formats
 * (docx/odt/md) → `text`; `pptx` → `slides`; `xlsx`/`csv` → `table`; `pdf` → `text`
 * (extracted-text fallback; a PDF may also be sent to the model natively).
 */
export const DOCUMENT_FORMATS = ['docx', 'doc', 'pptx', 'xlsx', 'pdf', 'odt', 'csv', 'md'] as const
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number]

/** Metadata common to every extraction — kept small + non-secret (safe to surface). */
export interface DocumentMetadata {
  /** The resolved source format (drives which driver ran). */
  format: DocumentFormat
  /** Original media type of the source bytes (best-effort; for provenance). */
  sourceMediaType?: string
  /** PDF page count (or docx page count) when the format exposes it. */
  pageCount?: number
  /** PPTX slide count when known. */
  slideCount?: number
  /** XLSX sheet names in workbook order (the extracted sheet is `sheetName`). */
  sheetNames?: string[]
  /** The specific sheet a `table` extraction came from (xlsx). */
  sheetName?: string
  /** Document title, when the source carries one. */
  title?: string
  /** Document author, when the source carries one. */
  author?: string
  /** True when a size cap or a chunk window truncated the emitted content. */
  truncated?: boolean
}

/** A text/slides extraction: Markdown the model reads directly. */
export interface ExtractedTextDocument {
  kind: 'text' | 'slides'
  /** Markdown rendering of the document text (GFM tables for docx). */
  markdown: string
  metadata: DocumentMetadata
}

/** A spreadsheet extraction: a dataview-compatible table (columns + rows). */
export interface ExtractedTableDocument {
  kind: 'table'
  columns: TableColumn[]
  rows: TableRow[]
  metadata: DocumentMetadata
}

/** The result of extracting a document — a discriminated union on `kind`. */
export type ExtractedDocument = ExtractedTextDocument | ExtractedTableDocument

/**
 * Optional chunk window so a caller can pull a slice of a large document instead of
 * the whole thing (keeps the model wire cheap). `sheet` selects an xlsx sheet;
 * `pageRange` narrows pdf pages / pptx slides; `offset`+`limit` page over table rows
 * (or characters of text). All optional — omit for the full document.
 */
export interface ExtractOptions {
  /** 1-based inclusive page/slide window (pdf pages, pptx slides). */
  pageRange?: { start: number; end?: number }
  /** XLSX sheet to extract, by name or 0-based index. Defaults to the first sheet. */
  sheet?: string | number
  /** Row offset (table) or character offset (text) into the extracted content. */
  offset?: number
  /** Max rows (table) or characters (text) to return from `offset`. */
  limit?: number
}

/** Bytes + resolved format handed to a driver. The service builds this. */
export interface DocumentInput {
  bytes: Buffer
  format: DocumentFormat
  /** Original media type, threaded into metadata. */
  mediaType?: string
  options?: ExtractOptions
}

/**
 * The AGNOSTIC extraction port. Each format's driver implements this; the registry
 * maps a {@link DocumentFormat} to a driver. A driver dynamically imports its heavy
 * parsing lib on first use, so the parsing libs never load at boot.
 */
export interface DocumentConverter {
  extract(input: DocumentInput): Promise<ExtractedDocument>
}

// ---------------------------------------------------------------------------
// Zod request/response schemas (HTTP + validation)
// ---------------------------------------------------------------------------

export const documentFormatSchema = z.enum(DOCUMENT_FORMATS)

export const extractOptionsSchema = z.object({
  pageRange: z
    .object({ start: z.number().int().min(1), end: z.number().int().min(1).optional() })
    .optional(),
  sheet: z.union([z.string().min(1), z.number().int().min(0)]).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100_000).optional(),
})

/**
 * Extract request: point the service at bytes via EITHER an absolute file `path`
 * OR a `mediaId` (a stored media content id). `format` overrides auto-detection
 * (from the path extension / media type). `options` narrows the extraction.
 */
export const extractRequestSchema = z
  .object({
    /** Absolute path to the source file on the API host. */
    path: z.string().min(1).optional(),
    /** A media store content id (`<sha256>.<ext>`) to resolve to bytes. */
    mediaId: z.string().min(1).optional(),
    /** Override the auto-detected format. */
    format: documentFormatSchema.optional(),
    /** Original media type, for detection + metadata when only bytes are known. */
    mediaType: z.string().min(1).optional(),
    options: extractOptionsSchema.optional(),
  })
  .refine((r) => Boolean(r.path) || Boolean(r.mediaId), {
    message: 'Provide a file path or a mediaId.',
    path: ['path'],
  })
export type ExtractRequest = z.infer<typeof extractRequestSchema>

/** Response of `POST /rpc/documents/extract`: the cache id + the extracted document. */
export interface ExtractResponse {
  /** Content-addressed cache id (`<sha256>.json`) — also the `GET /rpc/documents/:id` key. */
  id: string
  document: ExtractedDocument
}
