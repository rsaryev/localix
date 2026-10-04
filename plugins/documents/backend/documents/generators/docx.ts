/**
 * DOCX generator — a Markdown block list ({@link Block}) to a Word `.docx` (OOXML zip).
 * Uses the `docx` library's declarative model (`Document` → `Paragraph`/`Table` →
 * `TextRun`), loaded via dynamic `import()` on first use so it never rides the API boot
 * path (mirrors the extraction drivers' lazy discipline). Pragmatic subset: headings,
 * paragraphs, ordered/unordered lists, GFM tables, code, block-quotes, rules.
 */
import type { Block } from '../markdown/blocks'
import type { InlineSpan } from '../markdown/inline'

/** Convert styled spans to `docx` TextRuns. `code` spans render monospace. */
function toRuns(
  spans: InlineSpan[],
  TextRun: new (o: Record<string, unknown>) => unknown,
): unknown[] {
  const runs = spans
    .filter((s) => s.text.length > 0)
    .map(
      (s) =>
        new TextRun({
          text: s.text,
          bold: s.bold || undefined,
          italics: s.italic || undefined,
          font: s.code ? 'Courier New' : undefined,
        }),
    )
  return runs.length > 0 ? runs : [new TextRun({ text: '' })]
}

/** Generate `.docx` bytes from parsed Markdown blocks. */
export async function blocksToDocx(blocks: Block[]): Promise<Uint8Array> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
  } = await import('docx')

  const HEADINGS = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ]

  const Run = TextRun as unknown as new (o: Record<string, unknown>) => unknown
  const children: unknown[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        children.push(
          new Paragraph({
            heading: HEADINGS[Math.min(block.level, 6) - 1],
            children: toRuns(block.spans, Run) as never,
          }),
        )
        break
      }
      case 'paragraph': {
        children.push(new Paragraph({ children: toRuns(block.spans, Run) as never }))
        break
      }
      case 'list': {
        block.items.forEach((item, idx) => {
          if (block.ordered) {
            // Ordered lists need a document-level numbering definition; a numeric text
            // prefix keeps the generator dependency-free and the output correct.
            children.push(
              new Paragraph({
                indent: { left: 360 },
                children: [new Run({ text: `${idx + 1}. ` }), ...toRuns(item, Run)] as never,
              }),
            )
          } else {
            children.push(
              new Paragraph({ bullet: { level: 0 }, children: toRuns(item, Run) as never }),
            )
          }
        })
        break
      }
      case 'table': {
        const headerRow = new TableRow({
          tableHeader: true,
          children: block.header.map(
            (cell) =>
              new TableCell({
                children: [
                  new Paragraph({ children: [new Run({ text: cell, bold: true })] as never }),
                ],
              }),
          ),
        })
        const bodyRows = block.rows.map(
          (row) =>
            new TableRow({
              children: block.header.map(
                (_h, ci) =>
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new Run({ text: row[ci] ?? '' })] as never }),
                    ],
                  }),
              ),
            }),
        )
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...bodyRows],
          }),
        )
        break
      }
      case 'code': {
        // One monospace paragraph per code line so wrapping/indent stay predictable.
        const codeLines = block.text.split('\n')
        for (const codeLine of codeLines) {
          children.push(
            new Paragraph({
              spacing: { before: 0, after: 0 },
              children: [new Run({ text: codeLine, font: 'Courier New', size: 18 })] as never,
            }),
          )
        }
        break
      }
      case 'blockquote': {
        children.push(
          new Paragraph({
            indent: { left: 480 },
            children: toRuns(
              block.spans.map((s) => ({ ...s, italic: true })),
              Run,
            ) as never,
          }),
        )
        break
      }
      case 'hr': {
        children.push(
          new Paragraph({
            border: { bottom: { style: 'single', size: 6, color: 'AAAAAA' } } as never,
          }),
        )
        break
      }
    }
  }

  if (children.length === 0)
    children.push(new Paragraph({ children: [new Run({ text: '' })] as never }))

  const doc = new Document({ sections: [{ children: children as never }] })
  const buffer = await Packer.toBuffer(doc)
  return new Uint8Array(buffer)
}
