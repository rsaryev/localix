import type { PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs'

const MAX_PDF_PAGES = 400
const PDFJS_GLOBAL_KEYS = [
  'DOMMatrix',
  'Path2D',
  '_pdfjsTestingUtils',
  'pdfjsLib',
  'pdfjsWorker',
] as const
let pdfGlobalLeases = 0
let originalPdfGlobals: Map<string, PropertyDescriptor | undefined> | null = null

function acquirePdfGlobals(): () => void {
  if (pdfGlobalLeases === 0) {
    originalPdfGlobals = new Map(
      PDFJS_GLOBAL_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    )
  }
  pdfGlobalLeases += 1
  return () => {
    pdfGlobalLeases -= 1
    if (pdfGlobalLeases > 0 || !originalPdfGlobals) return
    for (const key of PDFJS_GLOBAL_KEYS) {
      const descriptor = originalPdfGlobals.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    originalPdfGlobals = null
  }
}

export interface ExtractedPdf {
  title?: string
  author?: string
  language?: string
  pages: Array<{ label: string; text: string }>
}

function presentationText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/\s+/gu, ' ').trim()
  return clean ? clean.slice(0, limit) : undefined
}

function pageText(items: Array<Record<string, unknown>>): string {
  let output = ''
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.str) continue
    const value = item.str.replaceAll('\u0000', '')
    if (
      output &&
      !/\s$/u.test(output) &&
      !/^[\s,.;:!?…)}\]]/u.test(value) &&
      !/[-–—/([{]$/u.test(output)
    ) {
      output += ' '
    }
    output += value
    if (item.hasEOL === true) output += '\n'
  }
  return output
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

/**
 * Text-first PDF adapter. Exact visual rendering stays available through the native
 * PDF viewer; Reader exposes bounded, searchable, selectable pages to annotations
 * and the agent context fabric.
 */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  const releaseGlobals = acquirePdfGlobals()
  let loadingTask: PDFDocumentLoadingTask | null = null
  try {
    const { default: DOMMatrix } = await import('@thednp/dommatrix')
    const globals = globalThis as Record<string, unknown>
    globals.DOMMatrix ??= DOMMatrix
    globals.Path2D ??= class ReaderTextOnlyPath2D {}
    globals.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      disableFontFace: true,
      useSystemFonts: true,
    })
    const pdf = await loadingTask.promise
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF has more than ${MAX_PDF_PAGES} pages`)
    }
    const [metadata, labels] = await Promise.all([pdf.getMetadata(), pdf.getPageLabels()])
    const info = metadata.info as Record<string, unknown>
    const pages: ExtractedPdf['pages'] = []
    for (let index = 0; index < pdf.numPages; index += 1) {
      const page = await pdf.getPage(index + 1)
      try {
        const content = await page.getTextContent({ disableNormalization: false })
        pages.push({
          label: presentationText(labels?.[index], 80) ?? `Page ${index + 1}`,
          text: pageText(content.items as Array<Record<string, unknown>>),
        })
      } finally {
        page.cleanup()
      }
    }
    return {
      title: presentationText(info.Title, 512),
      author: presentationText(info.Author, 512),
      language: presentationText(info.Language, 24),
      pages,
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (/password/iu.test(message)) throw new Error('Password-protected PDF is not supported')
    // pdf.js speaks its own language — `InvalidPDFException: Invalid PDF structure.`, a worker
    // version mismatch. One sentence for the pane, its exact words as the cause for `detail`.
    throw new Error('This PDF could not be read.', { cause })
  } finally {
    await loadingTask?.destroy()
    releaseGlobals()
  }
}
