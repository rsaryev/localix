import type { DocumentLayout, DocumentParagraph } from '@localixai/mini-app-sdk/document-layout'
import { NO_STANDARD_FONT, registerDocumentFonts } from './fonts'
import { drawContactIcon } from './contact-icon'
import { coveredParagraph } from './font-coverage'

/** Text stays selectable; embedded Unicode faces determine both measuring and wrapping. */
export async function layoutToPdf(layout: DocumentLayout): Promise<Uint8Array> {
  layout = {
    ...layout,
    blocks: await Promise.all(
      layout.blocks.map(async (block) => {
        if (block.kind === 'paragraph') return coveredParagraph(block)
        if (block.kind === 'header')
          return {
            ...block,
            left: await Promise.all(block.left.map(coveredParagraph)),
            right: await Promise.all(block.right.map(coveredParagraph)),
          }
        if (block.kind === 'columns')
          return {
            ...block,
            columns: await Promise.all(
              block.columns.map((column) => Promise.all(column.map(coveredParagraph))),
            ),
          }
        return block
      }),
    ),
  }
  const { default: PDFDocument } = await import('pdfkit')
  const doc = new PDFDocument({
    font: NO_STANDARD_FONT,
    size: 'A4',
    margin: layout.margin,
    bufferPages: true,
    info: { Title: layout.title, Creator: 'Localix' },
  })
  const fonts = layout.blocks.flatMap((block) => {
    const paragraphs =
      block.kind === 'paragraph'
        ? [block]
        : block.kind === 'columns'
          ? block.columns.flat()
          : block.kind === 'header'
            ? [...block.left, ...block.right]
            : []
    return paragraphs.flatMap((p) => [
      p.font,
      ...p.runs.flatMap((run) => (run.font ? [run.font] : [])),
    ])
  })
  await registerDocumentFonts(doc, fonts)
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  const left = layout.margin
  const width = doc.page.width - left * 2
  const bottom = () => doc.page.height - layout.margin
  const height = (p: DocumentParagraph, w: number) => {
    doc.font(`${p.font}-${p.runs.some((run) => run.bold) ? 1 : 0}`).fontSize(p.size)
    return (
      doc.heightOfString(p.runs.map((run) => run.text).join(''), {
        width: w - p.indent,
        lineGap: p.size * (p.lineHeight - 1.2),
        characterSpacing: p.tracking,
      }) +
      p.before +
      p.after
    )
  }
  const paragraph = (p: DocumentParagraph, x = left, w = width) => {
    doc.y += p.before
    doc.x = x
    if (p.icon) drawContactIcon(doc, p.icon, x + p.indent, doc.y + 1, p.size)
    const runs = p.runs.filter((run) => run.text.length)
    if (!runs.length) return
    runs.forEach((run, index) => {
      const face = (run.bold ? 1 : 0) + (run.italic ? 2 : 0)
      doc
        .font(`${run.font ?? p.font}-${face}`)
        .fontSize(p.size)
        .fillColor(p.muted ? '#555555' : '#111111')
      doc.text(run.text, {
        width: w,
        align: p.align,
        indent: index === 0 ? p.indent + (p.icon ? p.size + 4 : 0) : undefined,
        continued: index < runs.length - 1,
        lineGap: p.size * (p.lineHeight - 1.2),
        characterSpacing: p.tracking,
        ...(run.href ? { link: run.href, underline: true } : {}),
      })
    })
    doc.y += p.after
    doc.x = left
  }
  for (let index = 0; index < layout.blocks.length; index++) {
    const block = layout.blocks[index]
    if (block.kind === 'paragraph') {
      const next = layout.blocks[index + 1]
      const required =
        height(block, width) +
        (block.keepWithNext && next?.kind === 'paragraph'
          ? Math.min(height(next, width), next.size * 3)
          : block.keepWithNext
            ? 40
            : 0)
      if (required < bottom() - layout.margin && doc.y + required > bottom()) doc.addPage()
      paragraph(block)
    } else if (block.kind === 'header') {
      const photo = block.photo
      const split = block.right.length > 0
      const rightWidth = split ? width * 0.36 : 0
      const imageWidth = photo && !block.centered ? photo.size + 12 : 0
      const leftWidth = width - rightWidth - (split ? 16 : 0) - imageWidth
      const textHeight = Math.max(
        block.left.reduce((sum, p) => sum + height(p, leftWidth), 0),
        block.right.reduce((sum, p) => sum + height(p, rightWidth), 0),
      )
      const headerHeight =
        block.centered && photo
          ? textHeight + photo.size + 8
          : Math.max(textHeight, photo?.size ?? 0)
      if (doc.y + headerHeight > bottom()) doc.addPage()
      const top = doc.y
      if (photo) {
        const x = block.centered ? left + (width - photo.size) / 2 : left
        const y =
          block.centered || photo.align === 'top'
            ? top
            : photo.align === 'center'
              ? top + (headerHeight - photo.size) / 2
              : top + headerHeight - photo.size
        doc
          .save()
          .roundedRect(x, y, photo.size, photo.size, (photo.size * photo.radius) / 100)
          .clip()
        doc.image(Buffer.from(photo.data.split(',')[1], 'base64'), x, y, {
          cover: [photo.size, photo.size],
        })
        doc.restore()
      }
      doc.y = top + (block.centered && photo ? photo.size + 8 : 0)
      block.left.forEach((p) => paragraph(p, left + imageWidth, leftWidth))
      doc.y = top
      block.right.forEach((p) => paragraph(p, left + width - rightWidth, rightWidth))
      doc.y = top + headerHeight + 4
      doc.x = left
    } else if (block.kind === 'rule') {
      if (doc.y + 40 > bottom()) doc.addPage()
      doc.save().strokeColor('#333333').lineWidth(block.width)
      if (block.dashed) doc.dash(3, { space: 3 })
      doc
        .moveTo(left, doc.y)
        .lineTo(left + width, doc.y)
        .stroke()
        .restore()
      doc.y += 4
    } else if (block.kind === 'portrait') {
      if (doc.y + block.size > bottom()) doc.addPage()
      const x =
        block.align === 'center'
          ? left + (width - block.size) / 2
          : block.align === 'right'
            ? left + width - block.size
            : left
      doc
        .save()
        .roundedRect(x, doc.y, block.size, block.size, (block.size * block.radius) / 100)
        .clip()
      doc.image(Buffer.from(block.data.split(',')[1], 'base64'), x, doc.y, {
        cover: [block.size, block.size],
      })
      doc.restore()
      doc.y += block.size + 8
    } else {
      const cellWidth = (width - (block.columns.length - 1) * 16) / block.columns.length
      const count = Math.max(...block.columns.map((column) => column.length))
      for (let row = 0; row < count; row++) {
        const paragraphs = block.columns.map((column) => column[row])
        const rowHeight = Math.max(...paragraphs.map((p) => (p ? height(p, cellWidth) : 0)))
        if (doc.y + rowHeight > bottom()) doc.addPage()
        const top = doc.y
        paragraphs.forEach((p, col) => {
          if (!p) return
          doc.y = top
          paragraph(p, left + col * (cellWidth + 16), cellWidth)
        })
        doc.y = top + rowHeight
      }
    }
  }
  if (layout.pageNumbers) {
    const range = doc.bufferedPageRange()
    for (let page = 0; page < range.count; page++) {
      doc.switchToPage(range.start + page)
      const bottomMargin = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      doc
        .font('inter-0')
        .fontSize(8)
        .fillColor('#666666')
        .text(`${page + 1} / ${range.count}`, left, doc.page.height - 24, {
          width,
          align: 'center',
          lineBreak: false,
        })
      doc.page.margins.bottom = bottomMargin
    }
  }
  doc.end()
  return new Uint8Array(await result)
}
