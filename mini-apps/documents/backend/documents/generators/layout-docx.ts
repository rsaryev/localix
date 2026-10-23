import {
  documentFonts,
  type DocumentLayout,
  type DocumentParagraph,
} from '@localixai/mini-app-sdk/document-layout'
import { fontBytes } from './fonts'

/** Word deliberately remains linear, preserving template typography and canonical reading order. */
export async function layoutToDocx(layout: DocumentLayout): Promise<Uint8Array> {
  const { Document, Paragraph, TextRun, ExternalHyperlink, ImageRun, Packer, Footer, PageNumber } =
    await import('docx')
  const paragraph = (p: DocumentParagraph) =>
    new Paragraph({
      alignment: p.align,
      keepNext: p.keepWithNext,
      spacing: { before: p.before * 20, after: p.after * 20, line: Math.round(p.lineHeight * 240) },
      indent: { left: p.indent * 20 },
      children: p.runs.map((run) => {
        const text = new TextRun({
          text: run.text,
          bold: run.bold,
          italics: run.italic,
          font: documentFonts[run.font ?? p.font],
          size: p.size * 2,
          color: p.muted ? '555555' : '111111',
          characterSpacing: p.tracking * 20,
        })
        return run.href ? new ExternalHyperlink({ link: run.href, children: [text] }) : text
      }),
    })
  const children: InstanceType<typeof Paragraph>[] = []
  for (const block of layout.blocks) {
    if (block.kind === 'paragraph') children.push(paragraph(block))
    else if (block.kind === 'header') {
      if (block.photo)
        children.push(
          new Paragraph({
            alignment: block.centered ? 'center' : 'left',
            children: [
              new ImageRun({
                type: block.photo.data.startsWith('data:image/png') ? 'png' : 'jpg',
                data: Buffer.from(block.photo.data.split(',')[1], 'base64'),
                transformation: {
                  width: (block.photo.size * 4) / 3,
                  height: (block.photo.size * 4) / 3,
                },
              }),
            ],
          }),
        )
      children.push(...[...block.left, ...block.right].map(paragraph))
    } else if (block.kind === 'columns') {
      const count = Math.max(...block.columns.map((column) => column.length))
      for (let row = 0; row < count; row++)
        for (const column of block.columns) if (column[row]) children.push(paragraph(column[row]))
    } else if (block.kind === 'portrait')
      children.push(
        new Paragraph({
          alignment: block.align,
          children: [
            new ImageRun({
              type: block.data.startsWith('data:image/png') ? 'png' : 'jpg',
              data: Buffer.from(block.data.split(',')[1], 'base64'),
              transformation: { width: (block.size * 4) / 3, height: (block.size * 4) / 3 },
            }),
          ],
        }),
      )
    else
      children.push(
        new Paragraph({
          border: {
            bottom: {
              style: block.dashed ? 'dashed' : 'single',
              color: '333333',
              size: block.width * 8,
            },
          },
        }),
      )
  }
  const fonts = [
    ...new Set(
      layout.blocks.flatMap((block) =>
        block.kind === 'paragraph'
          ? [block.font]
          : block.kind === 'header'
            ? [...block.left, ...block.right].map((p) => p.font)
            : block.kind === 'columns'
              ? block.columns.flat().map((p) => p.font)
              : [],
      ),
    ),
  ]
  const doc = new Document({
    fonts: await Promise.all(
      fonts.map(async (font) => ({ name: documentFonts[font], data: await fontBytes(font) })),
    ),
    title: layout.title,
    creator: 'Localix',
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: layout.margin * 20,
              bottom: layout.margin * 20,
              left: layout.margin * 20,
              right: layout.margin * 20,
            },
          },
        },
        footers: layout.pageNumbers
          ? {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: 'center',
                    children: [
                      new TextRun({
                        children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
                        size: 16,
                      }),
                    ],
                  }),
                ],
              }),
            }
          : undefined,
        children,
      },
    ],
  })
  return new Uint8Array(await Packer.toBuffer(doc))
}
