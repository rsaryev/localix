import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { LoadingHint } from '@localixai/kit/empty-hint'
import type { ResumeDocument } from '../shared/schema'
import { PdfPreview } from './PdfPreview'

const EditorPanel = lazy(() =>
  import('./EditorPanel').then((module) => ({ default: module.EditorPanel })),
)

/** Adapt to the workbench pane, including when the chat sash moves or text size changes. */
export function ResumeCanvas({
  document,
  onChange,
  sectionId,
  onSection,
  pending,
  active = true,
  preview = false,
  previewId,
  onWideChange,
}: {
  document: ResumeDocument
  onChange: (document: ResumeDocument) => void
  sectionId: string | null
  onSection: (id: string | null) => void
  pending: boolean
  active?: boolean
  preview?: boolean
  previewId?: string
  onWideChange?: (wide: boolean) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const textSize = useRef<HTMLSpanElement>(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => {
      const rem =
        Number.parseFloat(getComputedStyle(element.ownerDocument.documentElement).fontSize) || 14
      const fits = element.getBoundingClientRect().width >= 56 * rem
      setWide(fits)
      onWideChange?.(fits)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // The root can keep the same box when its font changes; this rem-sized probe cannot.
    if (textSize.current) observer.observe(textSize.current)
    return () => observer.disconnect()
  }, [onWideChange])
  const previewVisible = preview
  const editorVisible = !preview || wide
  const split = wide && preview
  return (
    <div ref={container} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <span
        ref={textSize}
        aria-hidden
        className="pointer-events-none absolute h-0 w-4 overflow-hidden"
      />
      <div
        className="grid min-h-0 min-w-0 flex-1"
        style={{
          gridTemplateColumns: split ? 'minmax(0, 3fr) minmax(22rem, 2fr)' : 'minmax(0, 1fr)',
          gridTemplateRows: 'minmax(0, 1fr)',
        }}
      >
        <section
          id={previewId}
          aria-label="Document preview area"
          hidden={!previewVisible}
          style={{ gridRow: 1, gridColumn: 1, display: previewVisible ? 'flex' : 'none' }}
          className={previewVisible ? 'flex min-h-0 min-w-0 flex-col' : 'hidden'}
        >
          <PdfPreview document={document} active={active && previewVisible} />
        </section>
        <section
          aria-label="Resume editing area"
          hidden={!editorVisible}
          style={{
            gridRow: 1,
            gridColumn: split ? 2 : 1,
            display: editorVisible ? 'flex' : 'none',
          }}
          className={
            editorVisible
              ? `flex min-h-0 min-w-0 flex-col ${split ? 'border-l border-border' : ''}`
              : 'hidden'
          }
        >
          <Suspense fallback={<LoadingHint>Opening editor…</LoadingHint>}>
            <EditorPanel
              document={document}
              onChange={onChange}
              sectionId={sectionId}
              onSection={onSection}
              pending={pending}
            />
          </Suspense>
        </section>
      </div>
    </div>
  )
}
