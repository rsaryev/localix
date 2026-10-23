/**
 * Documents service — the single owner of detect → cache → extract → window. Both
 * the HTTP routes and the standard extraction capability call THIS (the service is
 * the narrow port). Agnostic: no import of chat, the agent loop, or the UI.
 *
 * Bytes come from an absolute file `path` (read here) or a `mediaId` (resolved via
 * an injected `loadMediaBytes`, so the service never imports the media store). The
 * heavy extraction is cached content-addressed; cheap row/character windowing is a
 * response transform applied AFTER the cache, so the cache id always addresses the
 * FULL extraction.
 */
import { readFile, stat } from 'node:fs/promises'
import type {
  DocumentConverter,
  DocumentFormat,
  ExtractOptions,
  ExtractRequest,
  ExtractResponse,
  ExtractedDocument,
  ExtractedTableDocument,
  ExtractedTextDocument,
} from './contracts'
import type { DocumentGenerator, GenerateInput, GeneratedDocument } from './generate-contracts'
import { errorMessage } from '@localixai/mini-app-sdk/backend'
import { DocumentError } from './errors'
import { converterForFormat, detectFormat } from './registry'
import { createDocumentGenerator } from './generators/generator'
import { hashDocumentInput, type DocumentStore } from './store'

/** Hard caps — keep a hostile/huge document from flooding memory or the model wire. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024
export const MAX_MARKDOWN_CHARS = 1_500_000
export const MAX_TABLE_ROWS = 10_000

export interface DocumentsService {
  /** Detect → cache → extract → window. Returns the cache id + the (windowed) document. */
  extract(req: ExtractRequest): Promise<ExtractResponse>
  /** Read a previously-cached FULL extraction by id (`<hash>.json`). Null if missing. */
  get(id: string): Promise<ExtractedDocument | null>
  /**
   * Reverse of extraction — turn model-authored content into a real deliverable:
   * Markdown → docx/pdf, rows / a Markdown table → xlsx. Returns the raw bytes +
   * media type + a suggested filename; persistence (to the media store) is the
   * caller's concern (the route persists through host media when configured).
   */
  generate(input: GenerateInput): Promise<GeneratedDocument>
}

export interface DocumentsServiceDeps {
  store: DocumentStore
  /** Resolve a media content id to raw bytes (injected from the media store at bootstrap). */
  loadMediaBytes?: (mediaId: string) => Promise<Buffer | null>
  /** Override the converter lookup (tests). */
  converterFor?: (format: DocumentFormat) => DocumentConverter
  /** Override the file-path reader (tests / alt fs). */
  readPath?: (path: string) => Promise<Buffer>
  /**
   * Override the file-path size probe (tests / alt fs). Paired with {@link readPath}:
   * the size is checked BEFORE the read, so an oversized file is refused instead of
   * being loaded into the API process first.
   */
  statPathSize?: (path: string) => Promise<number>
  /** Override the document generator (tests). */
  generator?: DocumentGenerator
}

/** The extraction-affecting option subset — the cache key covers these (NOT offset/limit). */
function extractionKey(format: DocumentFormat, options?: ExtractOptions): string {
  return JSON.stringify({
    format,
    pageRange: options?.pageRange ?? null,
    sheet: options?.sheet ?? null,
  })
}

/** Apply a character window + hard cap to a text/slides extraction. */
function windowText(doc: ExtractedTextDocument, options?: ExtractOptions): ExtractedTextDocument {
  const full = doc.markdown
  const offset = Math.min(Math.max(options?.offset ?? 0, 0), full.length)
  let out = full.slice(offset)
  let truncated = Boolean(doc.metadata.truncated) || offset > 0
  const limit = options?.limit
  if (limit != null && out.length > limit) {
    out = out.slice(0, limit)
    truncated = true
  }
  if (out.length > MAX_MARKDOWN_CHARS) {
    out = out.slice(0, MAX_MARKDOWN_CHARS)
    truncated = true
  }
  return { ...doc, markdown: out, metadata: { ...doc.metadata, truncated: truncated || undefined } }
}

/** Apply a row window + hard cap to a table extraction. */
function windowTable(
  doc: ExtractedTableDocument,
  options?: ExtractOptions,
): ExtractedTableDocument {
  const offset = Math.max(options?.offset ?? 0, 0)
  let rows = doc.rows.slice(offset)
  let truncated = Boolean(doc.metadata.truncated) || offset > 0
  const limit = options?.limit
  if (limit != null && rows.length > limit) {
    rows = rows.slice(0, limit)
    truncated = true
  }
  if (rows.length > MAX_TABLE_ROWS) {
    rows = rows.slice(0, MAX_TABLE_ROWS)
    truncated = true
  }
  return { ...doc, rows, metadata: { ...doc.metadata, truncated: truncated || undefined } }
}

/** Apply the offset/limit window to whichever kind of document was extracted. */
function windowDocument(doc: ExtractedDocument, options?: ExtractOptions): ExtractedDocument {
  return doc.kind === 'table' ? windowTable(doc, options) : windowText(doc, options)
}

export function createDocumentsService(deps: DocumentsServiceDeps): DocumentsService {
  const converterFor = deps.converterFor ?? converterForFormat
  const readPath = deps.readPath ?? ((p: string) => readFile(p))
  const statPathSize = deps.statPathSize ?? (async (p: string) => (await stat(p)).size)
  const generator = deps.generator ?? createDocumentGenerator()

  async function resolveBytes(req: ExtractRequest): Promise<Buffer> {
    if (req.path) {
      // SIZE FIRST. `MAX_INPUT_BYTES` is also checked on the resolved bytes below, but by
      // then the whole file is already resident: "open as table" on a multi-gigabyte csv
      // allocated all of it in the API process and only then refused it — the guard was
      // downstream of the cost it exists to prevent. A stat costs microseconds and the
      // file never enters memory. (The post-read check stays: it is the only one covering
      // the `mediaId` branch and any injected reader.)
      const size = await statPathSize(req.path).catch(() => undefined)
      if (size !== undefined && size > MAX_INPUT_BYTES) {
        throw new DocumentError(
          'too_large',
          `Document exceeds ${MAX_INPUT_BYTES} bytes (${size} bytes)`,
        )
      }
      try {
        return await readPath(req.path)
      } catch (err) {
        // A DocumentError from the reader already says exactly what went wrong; wrapping
        // it as `not_found` would report a 404 for a file that is right there.
        if (err instanceof DocumentError) throw err
        throw new DocumentError('not_found', `Cannot read ${req.path}`, { cause: err })
      }
    }
    if (req.mediaId) {
      if (!deps.loadMediaBytes)
        throw new DocumentError('invalid_input', 'media resolution is not configured')
      const bytes = await deps.loadMediaBytes(req.mediaId)
      if (!bytes) throw new DocumentError('not_found', `No media for id ${req.mediaId}`)
      return bytes
    }
    throw new DocumentError('invalid_input')
  }

  return {
    async extract(req) {
      const bytes = await resolveBytes(req)
      if (bytes.byteLength > MAX_INPUT_BYTES) {
        throw new DocumentError('too_large', `Document exceeds ${MAX_INPUT_BYTES} bytes`)
      }

      // A media id is `<hash>.<ext>` — its extension is an authoritative format hint
      // (set at upload from the filename), so a `mediaId`-only extract (no path, no
      // mediaType) still detects the format.
      const format =
        req.format ?? detectFormat({ path: req.path ?? req.mediaId, mediaType: req.mediaType })
      if (!format)
        throw new DocumentError('unsupported_format', 'Could not detect the document format')

      const hash = hashDocumentInput(bytes, extractionKey(format, req.options))

      // Cache: the id addresses the FULL extraction (keyed by bytes + driver options,
      // NOT offset/limit — those window the response). A hit skips the heavy parse.
      const cached = await deps.store.getByHash(hash)
      const full =
        cached ??
        (await (async () => {
          const converter = converterFor(format)
          let doc: ExtractedDocument
          try {
            doc = await converter.extract({
              bytes,
              format,
              mediaType: req.mediaType ?? undefined,
              options: req.options,
            })
          } catch (err) {
            if (err instanceof DocumentError) throw err
            throw new DocumentError('extract_failed', errorMessage(err), { cause: err })
          }
          await deps.store.put(hash, doc)
          return doc
        })())

      return { id: `${hash}.json`, document: windowDocument(full, req.options) }
    },

    get(id) {
      return deps.store.get(id)
    },

    async generate(input) {
      try {
        return await generator.generate(input)
      } catch (err) {
        if (err instanceof DocumentError) throw err
        throw new DocumentError('generate_failed', errorMessage(err), { cause: err })
      }
    },
  }
}
