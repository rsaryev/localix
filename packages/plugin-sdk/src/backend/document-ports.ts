import { plural } from './plural'

/**
 * Document extraction/generation PORT types + the pure model-facing renderer.
 *
 * These are host/extension seams: core's binary-document fallback,
 * attachment-spill previews and model history consume the extractor callback;
 * any extension may implement the ports and contribute them as capabilities.
 * Pure types + string math — no I/O.
 */

// ---------------------------------------------------------------------------
// Extraction port
// ---------------------------------------------------------------------------

/** Extraction-affecting window forwarded to the documents service. */
export interface DocExtractParams {
  /** Absolute path to the source file on the API host. */
  path: string
  /** 1-based inclusive page/slide window (pdf pages, pptx slides). */
  pageRange?: { start: number; end?: number }
  /** XLSX sheet to extract, by name or 0-based index. */
  sheet?: string | number
  /** Row offset (table) or character offset (text) into the extracted content. */
  offset?: number
}

/** Small, non-secret metadata subset the renderer emits (mirrors `DocumentMetadata`). */
export interface DocExtractMetadata {
  format: string
  pageCount?: number
  slideCount?: number
  sheetNames?: string[]
  sheetName?: string
  title?: string
  author?: string
  /** True when a size cap / window truncated the emitted content. */
  truncated?: boolean
}

export interface DocExtractText {
  kind: 'text' | 'slides'
  markdown: string
  metadata: DocExtractMetadata
}

export interface DocExtractTable {
  kind: 'table'
  columns: string[]
  rows: Array<Array<string | number | boolean | null>>
  metadata: DocExtractMetadata
}

export type DocExtractResult = DocExtractText | DocExtractTable

/** The narrow port: bytes in (by absolute path), an extracted document out. */
export interface DocumentExtractPort {
  extract(params: DocExtractParams): Promise<DocExtractResult>
}

/** The extraction window a `read` call may narrow to: a page/slide range or one sheet. */
export type DocExtractWindow = Pick<DocExtractParams, 'pageRange' | 'sheet'>

/**
 * Callback form used by the `read` tool: an office/PDF path → its extracted text
 * (already bounded + rendered), or null when extraction isn't possible. Injected so
 * `read` on a `.docx` yields text instead of a binary-file refusal, without `read`
 * importing an implementation. `window` forwards `read`'s `pages` / `sheet` inputs.
 */
export type DocumentTextExtractor = (
  targetPath: string,
  offset?: number,
  window?: DocExtractWindow,
) => Promise<string | null>

// ---------------------------------------------------------------------------
// Generation port
// ---------------------------------------------------------------------------

export type DocGenerateFormat = 'docx' | 'xlsx' | 'pdf'

export interface DocGenerateParams {
  format: DocGenerateFormat
  /** Markdown for docx/pdf; a Markdown table or JSON rows for xlsx. */
  content: string
  /** Optional preferred base name (the tool writes to `path`, so mostly informational). */
  filename?: string
}

export interface DocGenerateResult {
  bytes: Uint8Array
  mediaType: string
  suggestedFilename: string
}

/** The narrow port: content in, encoded document bytes out. */
export interface DocumentGeneratePort {
  generate(params: DocGenerateParams): Promise<DocGenerateResult>
}

// ---------------------------------------------------------------------------
// Pure model-facing rendering shared by every document-extraction consumer.
// ---------------------------------------------------------------------------

/** Rows previewed for a spreadsheet before the "page further" hint. */
export const PREVIEW_ROWS = 50
/** Byte cap on the model-facing content (text or rendered table). */
export const MAX_MODEL_CHARS = 60_000
/** Per-cell character cap in the rendered preview table. */
const MAX_CELL = 200

function cellText(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'string' ? value : String(value)
  // Keep pipe tables intact + bounded: escape `|`, flatten newlines, cap length.
  const flat = s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  return flat.length > MAX_CELL ? `${flat.slice(0, MAX_CELL)}…` : flat
}

/** Render a GFM pipe table (header + separator + up to PREVIEW_ROWS rows). */
function markdownTable(
  columns: string[],
  rows: Array<Array<string | number | boolean | null>>,
): string {
  const header = `| ${columns.map((c) => cellText(c)).join(' | ')} |`
  const sep = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${columns.map((_, i) => cellText(r[i] ?? null)).join(' | ')} |`)
  return [header, sep, ...body].join('\n')
}

/** Short provenance header, e.g. "[DOCX · 12 pages]" or "[PPTX · 8 slides]". */
function textHeader(meta: DocExtractMetadata): string {
  const bits = [meta.format.toUpperCase()]
  if (meta.pageCount != null) bits.push(plural(meta.pageCount, 'page'))
  if (meta.slideCount != null) bits.push(plural(meta.slideCount, 'slide'))
  if (meta.title) bits.push(`“${meta.title}”`)
  return `[${bits.join(' · ')}]`
}

function renderText(doc: DocExtractText, offset: number): string {
  let md = doc.markdown
  let hint = ''
  if (md.length > MAX_MODEL_CHARS) {
    md = md.slice(0, MAX_MODEL_CHARS)
    hint = `\n\n… [truncated at ${MAX_MODEL_CHARS} characters — read the document again with offset=${
      offset + MAX_MODEL_CHARS
    } to read the next part.]`
  }
  return `${textHeader(doc.metadata)}\n\n${md || '(no extractable text)'}${hint}`
}

function renderTable(doc: DocExtractTable, offset: number): string {
  const { columns, rows, metadata } = doc
  const shown = rows.slice(0, PREVIEW_ROWS)
  const lines: string[] = []
  const rowNote = offset > 0 ? ` from row ${offset}` : ''
  const capNote = metadata.truncated ? '+' : ''
  lines.push(
    `Spreadsheet [${metadata.format.toUpperCase()}]${
      metadata.sheetName ? ` · sheet "${metadata.sheetName}"` : ''
    }: ${columns.length} column(s), ${rows.length}${capNote} row(s)${rowNote}.`,
  )
  if (metadata.sheetNames && metadata.sheetNames.length > 1) {
    lines.push(
      `Sheets: ${metadata.sheetNames.join(', ')} — pass sheet=<name|index> to read another.`,
    )
  }
  lines.push('')
  lines.push(markdownTable(columns, shown))
  if (rows.length > PREVIEW_ROWS) {
    lines.push('')
    lines.push(
      `… ${rows.length - PREVIEW_ROWS} more row(s). Pass offset=${offset + PREVIEW_ROWS} to page further.`,
    )
  }
  const out = lines.join('\n')
  return out.length > MAX_MODEL_CHARS ? `${out.slice(0, MAX_MODEL_CHARS)}\n… [truncated]` : out
}

/** Render an extraction result into bounded, model-facing text. */
export function renderDocumentForModel(doc: DocExtractResult, offset = 0): string {
  return doc.kind === 'table' ? renderTable(doc, offset) : renderText(doc, offset)
}
