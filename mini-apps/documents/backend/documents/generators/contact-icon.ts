import type { DocumentParagraph } from '@localixai/mini-app-sdk/document-layout'
/** Small neutral document glyphs; no system-font symbol substitutions. */
export function drawContactIcon(
  doc: PDFKit.PDFDocument,
  icon: NonNullable<DocumentParagraph['icon']>,
  x: number,
  y: number,
  size: number,
) {
  doc
    .save()
    .translate(x, y)
    .scale(size / 24)
    .strokeColor('#555555')
    .lineWidth(1.5)
  if (icon === 'email') {
    doc.roundedRect(2, 4, 20, 16, 2).stroke()
    doc.moveTo(2, 5).lineTo(12, 13).lineTo(22, 5).stroke()
  } else if (icon === 'location') {
    doc.path('M 12 22 C 8 16 4 13 4 9 A 8 8 0 0 1 20 9 C 20 13 16 16 12 22').stroke()
    doc.circle(12, 9, 2.5).stroke()
  } else if (icon === 'phone') {
    doc
      .path(
        'M 5 2 L 9 2 L 11 8 L 8 10 C 10 13 11 14 14 16 L 16 13 L 22 15 L 22 19 C 22 23 17 23 12 20 C 6 17 2 11 2 6 C 2 3 3 2 5 2',
      )
      .stroke()
  } else {
    doc
      .path(
        'M 9 15 L 15 9 M 8 13 L 5 16 A 4 4 0 0 0 11 22 L 14 19 M 10 5 L 13 2 A 4 4 0 0 1 19 8 L 16 11',
      )
      .stroke()
  }
  doc.restore()
}
