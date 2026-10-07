import type * as PdfEngine from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

let engine: Promise<typeof PdfEngine> | undefined
export function loadPdfEngine() {
  return (engine ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdf, worker]) => {
    pdf.GlobalWorkerOptions.workerSrc = worker.default
    return pdf
  }))
}

/** Cap backing-store density without changing the document's physical proportions. */
export function pdfPageScale(width: number, pageWidth: number, density: number) {
  const scale = Math.max(1, width) / Math.max(1, pageWidth)
  return { scale, density: Math.min(2, Math.max(1, density)) }
}
export type { PDFDocumentProxy }
