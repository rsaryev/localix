import { useEffect, useRef, useState } from 'react'
import { loadPdfEngine, pdfPageScale, type PDFDocumentProxy } from './pdf-engine'
import './pdf-pages.css'

export interface PdfPagesProps {
  blob: Blob
  'aria-label'?: string
  onError?: (error: Error) => void
}

/** Fit actual PDF pages to the available pane, with selectable text and lazy canvas rendering. */
export function PdfPages({ blob, 'aria-label': label = 'PDF document', onError }: PdfPagesProps) {
  const root = useRef<HTMLDivElement>(null)
  const failure = useRef(onError)
  failure.current = onError
  const [width, setWidth] = useState(0)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const pane = root.current
    if (!pane) return
    const measure = () => setWidth(Math.max(0, pane.clientWidth - 24))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<Awaited<ReturnType<typeof loadPdfEngine>>['getDocument']> | undefined
    let loaded: PDFDocumentProxy | undefined
    setError(null)
    Promise.all([loadPdfEngine(), blob.arrayBuffer()])
      .then(async ([engine, bytes]) => {
        if (cancelled) return
        task = engine.getDocument({ data: new Uint8Array(bytes) })
        loaded = await task.promise
        if (!cancelled) setPdf(loaded!)
        else void loaded!.loadingTask.destroy()
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        const problem = cause instanceof Error ? cause : new Error('Cannot display PDF.')
        setError(problem.message)
        failure.current?.(problem)
      })
    return () => {
      cancelled = true
      if (!loaded) void task?.destroy()
    }
  }, [blob])
  useEffect(
    () => () => {
      void pdf?.loadingTask.destroy()
    },
    [pdf],
  )
  return (
    <div
      ref={root}
      role="region"
      aria-label={label}
      tabIndex={0}
      className="min-h-0 min-w-0 flex-1 overflow-auto p-3"
    >
      {error ? (
        <p role="alert" className="text-xs text-status-error">
          {error}
        </p>
      ) : null}
      {!pdf && !error ? (
        <p role="status" className="text-xs text-text-soft">
          Loading pages…
        </p>
      ) : null}
      {pdf && width > 0
        ? Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={`${pdf.fingerprints[0]}-${index}`}
              pdf={pdf}
              number={index + 1}
              width={width}
            />
          ))
        : null}
    </div>
  )
}

function PdfPage({ pdf, number, width }: { pdf: PDFDocumentProxy; number: number; width: number }) {
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [height, setHeight] = useState(width * Math.SQRT2)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const node = container.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry!.isIntersecting), {
      root: node.parentElement,
      rootMargin: '500px',
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    const pageCanvas = canvas.current
    let cancelled = false
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    let layer: InstanceType<Awaited<ReturnType<typeof loadPdfEngine>>['TextLayer']> | undefined
    Promise.all([pdf.getPage(number), loadPdfEngine()])
      .then(async ([page, engine]) => {
        if (cancelled || !canvas.current || !text.current) return
        const sizing = pdfPageScale(width, page.getViewport({ scale: 1 }).width, devicePixelRatio)
        const viewport = page.getViewport({ scale: sizing.scale })
        setHeight(viewport.height)
        canvas.current.width = Math.ceil(viewport.width * sizing.density)
        canvas.current.height = Math.ceil(viewport.height * sizing.density)
        text.current.replaceChildren()
        text.current.style.setProperty('--total-scale-factor', String(sizing.scale))
        render = page.render({
          canvas: canvas.current,
          viewport,
          transform: [sizing.density, 0, 0, sizing.density, 0, 0],
        })
        layer = new engine.TextLayer({
          textContentSource: page.streamTextContent(),
          container: text.current,
          viewport,
        })
        await Promise.all([render.promise, layer.render()])
        if (!cancelled) setError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Cannot display page.')
      })
    return () => {
      cancelled = true
      render?.cancel()
      layer?.cancel()
      if (pageCanvas) {
        pageCanvas.width = 0
        pageCanvas.height = 0
      }
    }
  }, [pdf, number, width, visible])
  return (
    <div ref={container} className="mb-4 last:mb-0">
      <div className="relative overflow-hidden bg-document-paper" style={{ width, height }}>
        <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 h-full w-full" />
        <div ref={text} className="kit-pdf-text" role="document" aria-label={`Page ${number}`} />
        {error ? (
          <p role="alert" className="relative p-3 text-xs text-status-error">
            {error}
          </p>
        ) : null}
      </div>
      <p className="pt-2 text-center text-xs text-text-soft">
        Page {number} of {pdf.numPages}
      </p>
    </div>
  )
}
