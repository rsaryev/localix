/**
 * `read` on a PDF or office document: its extracted text, through the injected extractor.
 *
 * The extractable set mirrors what the document extractor's registry converts (its binary
 * formats; csv/md are plain text and take the normal text path). `pages` and `sheet` narrow
 * the extraction itself, so a 300-page PDF or a twelve-sheet workbook is read where it matters
 * instead of paged through from the top.
 */
import type { DocExtractParams, DocumentTextExtractor } from '@localixai/mini-app-sdk/backend'
import { MAX_OUTPUT_BYTES } from './read-output'
import { renderLineRange } from './read-render'

const EXTRACTABLE_DOC_EXTS = new Set([
  'pdf',
  'docx',
  'doc',
  'pptx',
  'odt',
  'xlsx',
  'xls',
  'xlsm',
  'xlsb',
])

export function isExtractableDocument(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 && EXTRACTABLE_DOC_EXTS.has(filePath.slice(dot + 1).toLowerCase())
}

/** `"3"`, `"1-5"` or `"10-"` → a 1-based page window; a string explains a malformed range. */
export function parsePageRange(pages: string): NonNullable<DocExtractParams['pageRange']> | string {
  const m = /^\s*(\d+)\s*(?:(-)\s*(\d+)?)?\s*$/.exec(pages)
  const start = m ? Number(m[1]) : 0
  const end = m?.[3] ? Number(m[3]) : m?.[2] ? undefined : start
  if (!m || start < 1 || (end !== undefined && end < start)) {
    return `Invalid pages "${pages}": use a 1-based page or range such as "3", "1-5" or "10-".`
  }
  return end === undefined ? { start } : { start, end }
}

export interface DocumentReadInput {
  byte_offset?: number
  start_line?: number
  end_line?: number
  pages?: string
  sheet?: string
}

export type DocumentRead = { output: string; isError?: true } | null

/**
 * Extracted text for a document, a line range of it, or an explanation when no extractor is
 * loaded. Null when extraction failed — the caller then reports the file as binary.
 */
export async function readDocument(
  extractor: DocumentTextExtractor | undefined,
  targetPath: string,
  input: DocumentReadInput,
): Promise<DocumentRead> {
  if (!extractor) {
    return {
      output: `${targetPath} is a PDF/office document, and document extraction is unavailable in this run (no document extractor plugin is loaded). Install or enable one from the Store to read its text, or convert it with \`Bash\` (e.g. \`pdftotext\`).`,
    }
  }
  const pageRange = input.pages ? parsePageRange(input.pages) : undefined
  if (typeof pageRange === 'string') return { output: pageRange, isError: true }
  const extracted = await extractor(targetPath, input.byte_offset, {
    ...(pageRange ? { pageRange } : {}),
    ...(input.sheet ? { sheet: input.sheet } : {}),
  })
  if (extracted == null) return null
  // A line range is meaningful on the EXTRACTED text, not on the document's bytes. This
  // branch once returned the whole extraction while the model believed it got lines 100-200
  // — and `attachment-spill`'s manifest tells it to ask for exactly that.
  if (input.start_line == null) return { output: extracted }
  const range = renderLineRange(
    extracted,
    targetPath,
    input.start_line,
    input.end_line ?? undefined,
    MAX_OUTPUT_BYTES,
  )
  return { output: range.output }
}
