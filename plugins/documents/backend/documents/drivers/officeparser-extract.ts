/**
 * Shared extraction over `officeparser` — the modern, strictly-typed parser that
 * covers PPTX, ODT, and PDF (and more) and emits Markdown. Parses the bytes to an
 * AST, then renders Markdown; when a `pageRange` is given it filters the AST's
 * top-level slide/page nodes to that 1-based window before rendering.
 *
 * officeparser loads via dynamic `import()` on first use, so it (and its transitive
 * PDF machinery) never loads at boot. Used by the pptx / odt / pdf drivers.
 */
import type { DocumentFormat, ExtractOptions, ExtractedTextDocument } from '../contracts'
import { DocumentError } from '../errors'

/** The slice of officeparser's surface we call (typed loosely — lib ships its own types). */
interface OfficeParserLib {
  parseOffice: (buffer: Buffer, config?: Record<string, unknown>) => Promise<OfficeAst>
  OfficeGenerator?: {
    generate: (ast: unknown, dest: string, cfg?: unknown) => Promise<{ value: unknown }>
  }
}
interface OfficeContentNode {
  nodeType?: string
  metadata?: { slideNumber?: number; pageNumber?: number }
}
interface OfficeAst {
  type?: string
  metadata?: { title?: string; author?: string }
  content?: OfficeContentNode[]
  to?: (dest: string, cfg?: unknown) => Promise<{ value: unknown }>
}

function unwrap(mod: unknown): OfficeParserLib {
  const m = mod as { parseOffice?: unknown; default?: unknown }
  return (m?.parseOffice ? m : (m.default as OfficeParserLib)) as OfficeParserLib
}

/** Count top-level content nodes of a given type (slides / pages), if the AST exposes them. */
function countNodes(ast: OfficeAst, nodeType: string): number | undefined {
  const n = (ast.content ?? []).filter((node) => node?.nodeType === nodeType).length
  return n > 0 ? n : undefined
}

/** Filter the AST content to a 1-based inclusive slide/page window (best-effort). */
function sliceToPageRange(
  ast: OfficeAst,
  range: NonNullable<ExtractOptions['pageRange']>,
): OfficeAst {
  const content = ast.content ?? []
  const filtered = content.filter((node) => {
    const num = node?.metadata?.slideNumber ?? node?.metadata?.pageNumber
    // Keep nodes without a page/slide index (masters, shared content) — only drop
    // paginated nodes that fall outside the window.
    if (typeof num !== 'number') return true
    return num >= range.start && (range.end == null || num <= range.end)
  })
  return { ...ast, content: filtered }
}

async function renderMarkdown(
  lib: OfficeParserLib,
  ast: OfficeAst,
  filtered: OfficeAst,
): Promise<string> {
  // A filtered AST is a plain spread (no `.to` method) → use the generator; an
  // unfiltered AST can use either. Prefer the generator when present for consistency.
  const gen = lib.OfficeGenerator?.generate
  const result = gen
    ? await gen(filtered, 'md')
    : filtered.to
      ? await filtered.to('md')
      : ast.to
        ? await ast.to('md')
        : null
  if (!result) throw new DocumentError('extract_failed', 'officeparser produced no output')
  if (typeof result.value === 'string') return result.value
  if (result.value instanceof Uint8Array) return new TextDecoder().decode(result.value)
  if (result.value == null) return ''
  throw new DocumentError('extract_failed', 'officeparser produced non-text output')
}

export interface OfficeParserExtractInput {
  bytes: Buffer
  format: DocumentFormat
  kind: 'text' | 'slides'
  mediaType?: string
  options?: ExtractOptions
}

/** Parse + render a PPTX/ODT/PDF document to a Markdown `ExtractedTextDocument`. */
export async function extractViaOfficeParser(
  input: OfficeParserExtractInput,
): Promise<ExtractedTextDocument> {
  const lib = unwrap(await import('officeparser'))
  const ast = await lib.parseOffice(input.bytes, {
    ignoreNotes: false,
    // officeparser 8 starts pdf.js in a child of `process.execPath` by default. Under `bun test`
    // that parse never settled, and in the desktop app `execPath` is the packaged API binary, not
    // a runtime for pdf.js's script; pdf.js runs in this process, as it did before 8.
    pdfParserConfig: { separateProcess: false },
  })

  const slideCount = countNodes(ast, 'slide')
  const pageCount = countNodes(ast, 'page')
  const range = input.options?.pageRange
  const target = range ? sliceToPageRange(ast, range) : ast
  const markdown = (await renderMarkdown(lib, ast, target)).trim()

  return {
    kind: input.kind,
    markdown,
    metadata: {
      format: input.format,
      sourceMediaType: input.mediaType,
      title: ast.metadata?.title,
      author: ast.metadata?.author,
      slideCount,
      pageCount,
      truncated: range ? true : undefined,
    },
  }
}
