import { useEffect, useState } from 'react'
import { PdfPages } from '@localixai/kit/pdf-pages'
import { Button } from '@localixai/kit/button'
import type { ResumeDocument } from '../shared/schema'
import { renderResumePdf } from './pdf'
import { Preview } from './Preview'

/** The A4 preview uses the actual downloadable PDF, including font embedding and pagination. */
export function PdfPreview({ document, active }: { document: ResumeDocument; active: boolean }) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [rendered, setRendered] = useState<ResumeDocument | null>(null)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const timer = setTimeout(() => {
      renderResumePdf(document).then(
        (blob) => {
          if (cancelled) return
          setBlob(blob)
          setRendered(document)
          setError(null)
        },
        (failure) => {
          if (!cancelled)
            setError(failure instanceof Error ? failure.message : 'Could not render PDF.')
        },
      )
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [document, active, retry])
  return (
    <div
      aria-busy={rendered !== document && !error}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs text-status-error"
        >
          <span className="min-w-0 flex-1">PDF preview unavailable. {error}</span>
          <Button size="sm" variant="ghost" onClick={() => setRetry((value) => value + 1)}>
            Retry preview
          </Button>
        </div>
      ) : (
        rendered !== document && (
          <p role="status" className="sr-only">
            Updating A4 preview…
          </p>
        )
      )}
      {blob ? (
        <PdfPages blob={blob} aria-label="Resume PDF preview" />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-4">
          <div className="bg-document-paper text-document-ink">
            <Preview document={document} />
          </div>
        </div>
      )}
    </div>
  )
}
