/**
 * PDF generator — a Markdown block list ({@link Block}) to a real `%PDF-` document via
 * `pdfkit`, a pure-JS engine (NO headless browser). Loaded with a dynamic `import()` so
 * the ~few-MB library never rides the API boot path. Pragmatic subset: headings,
 * styled paragraphs, ordered/unordered lists, GFM tables (manual grid), fenced code,
 * block-quotes, rules. Real bold/italic/monospace via pdfkit's standard font family.
 */
import type { Block } from '../markdown/blocks'
import type { InlineSpan } from '../markdown/inline'
import { NO_STANDARD_FONT, registerDocumentFonts } from './fonts'

/** Standard-14 font name for a span's styling. */
function fontFor(span: InlineSpan): string {
  if (span.code) return 'jetbrains-mono-0'
  if (span.bold && span.italic) return 'inter-3'
  if (span.bold) return 'inter-1'
  if (span.italic) return 'inter-2'
  return 'inter-0'
}

/** Point size per heading level (h1 largest → h6 smallest). */
const HEADING_SIZES = [22, 18, 15, 13, 12, 11]
const BODY_SIZE = 11

/** Render styled spans as one flowing paragraph, switching fonts per span. */
function renderSpans(
  doc: PDFKit.PDFDocument,
  spans: InlineSpan[],
  size: number,
  opts: { indent?: number } = {},
): void {
  const parts = spans.filter((s) => s.text.length > 0)
  if (parts.length === 0) {
    doc.font('inter-0').fontSize(size).text(' ')
    return
  }
  doc.fontSize(size)
  parts.forEach((span, i) => {
    doc.font(fontFor(span)).text(span.text, {
      continued: i < parts.length - 1,
      indent: i === 0 ? opts.indent : undefined,
    })
  })
}

/** Draw a manual table grid (equal columns), paginating on overflow. */
function renderTable(doc: PDFKit.PDFDocument, header: string[], rows: string[][]): void {
  const cols = Math.max(header.length, 1)
  const left = doc.page.margins.left
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const colWidth = usable / cols
  const pad = 4
  const cellSize = 10

  const rowHeight = (cells: string[], font: string): number => {
    doc.font(font).fontSize(cellSize)
    let max = 0
    for (let c = 0; c < cols; c++) {
      const h = doc.heightOfString(cells[c] ?? '', { width: colWidth - pad * 2 })
      if (h > max) max = h
    }
    return max + pad * 2
  }

  const drawRow = (cells: string[], font: string): void => {
    const height = rowHeight(cells, font)
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage()
    const top = doc.y
    doc.font(font).fontSize(cellSize)
    for (let c = 0; c < cols; c++) {
      const x = left + c * colWidth
      doc.rect(x, top, colWidth, height).strokeColor('#cccccc').lineWidth(0.5).stroke()
      doc
        .fillColor('#000000')
        .text(cells[c] ?? '', x + pad, top + pad, { width: colWidth - pad * 2 })
    }
    doc.y = top + height
    doc.x = left
  }

  drawRow(header, 'inter-1')
  for (const row of rows) drawRow(row, 'inter-0')
  doc.moveDown(0.5)
}

/** Generate `.pdf` bytes from parsed Markdown blocks. */
export async function blocksToPdf(blocks: Block[]): Promise<Uint8Array> {
  // PDFKit's Node build loads its standard-font metrics as modules, so a bundle carries them. Up
  // to 0.19 it read them through a build-machine `__dirname`, which Bun kept as an absolute path:
  // a packaged CLI moved off the builder could not generate even Helvetica.
  const { default: PDFDocument } = await import('pdfkit')
  const doc = new PDFDocument({
    size: 'A4',
    margin: 54,
    autoFirstPage: true,
    font: NO_STANDARD_FONT,
  })

  await registerDocumentFonts(doc, ['inter', 'jetbrains-mono'])

  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        doc.moveDown(0.4)
        renderSpans(doc, block.spans, HEADING_SIZES[Math.min(block.level, 6) - 1])
        doc.moveDown(0.2)
        break
      }
      case 'paragraph': {
        renderSpans(doc, block.spans, BODY_SIZE)
        doc.moveDown(0.5)
        break
      }
      case 'list': {
        block.items.forEach((item, idx) => {
          const prefix: InlineSpan = { text: block.ordered ? `${idx + 1}. ` : '•  ' }
          renderSpans(doc, [prefix, ...item], BODY_SIZE, { indent: 12 })
        })
        doc.moveDown(0.5)
        break
      }
      case 'table': {
        renderTable(doc, block.header, block.rows)
        break
      }
      case 'code': {
        doc.font('jetbrains-mono-0').fontSize(9).fillColor('#333333')
        doc.text(block.text || ' ', { indent: 12 })
        doc.fillColor('#000000')
        doc.moveDown(0.5)
        break
      }
      case 'blockquote': {
        doc.fillColor('#555555')
        renderSpans(
          doc,
          block.spans.map((s) => ({ ...s, italic: true })),
          BODY_SIZE,
          { indent: 18 },
        )
        doc.fillColor('#000000')
        doc.moveDown(0.5)
        break
      }
      case 'hr': {
        const left = doc.page.margins.left
        const right = doc.page.width - doc.page.margins.right
        doc.moveDown(0.3)
        doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').lineWidth(1).stroke()
        doc.moveDown(0.5)
        doc.x = left
        break
      }
    }
  }

  doc.end()
  const buffer = await done
  return new Uint8Array(buffer)
}
