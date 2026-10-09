import { useMotionSessionId } from './scope'
import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { ChoiceMenu } from './ChoiceMenu'
import type { MotionDocument } from '../shared/schema'
import { documentSchema } from '../shared/schema'
import { downloadBlob } from './media'
import type { VideoFormat } from './export'
import { validateEditorNumbers } from './number-validity'

export function ExportPanel({ document }: { document: MotionDocument }) {
  const sessionId = useMotionSessionId()
  const [format, setFormat] = useState<VideoFormat>('mp4')
  const [size, setSize] = useState(1080)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState('')
  const running = useRef<AbortController | null>(null)
  useEffect(() => () => running.current?.abort(), [])
  const busy = progress !== null
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <ChoiceMenu
          label={format.toUpperCase()}
          disabled={busy}
          entries={(['mp4', 'webm'] as const).map((value) => ({
            id: value,
            label: value.toUpperCase(),
            selected: value === format,
            onSelect: () => setFormat(value),
          }))}
        />
        <ChoiceMenu
          label={`${size}p`}
          disabled={busy}
          entries={[720, 1080].map((value) => ({
            id: String(value),
            label: `${value}p`,
            selected: value === size,
            onSelect: () => setSize(value),
          }))}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(event) => {
            if (!validateEditorNumbers(event.currentTarget)) {
              setError('Finish the number fields before exporting.')
              return
            }
            void (async () => {
              const parsed = documentSchema.safeParse(document)
              if (!parsed.success) {
                setError('Fix the scene settings before exporting.')
                return
              }
              const abort = new AbortController()
              running.current = abort
              setProgress(0)
              setError('')
              setComplete('')
              try {
                const { exportVideo } = await import('./export')
                const blob = await exportVideo(parsed.data, {
                  sessionId,
                  format,
                  size,
                  signal: abort.signal,
                  onProgress: setProgress,
                })
                downloadBlob(blob, `${document.title}.${format}`)
                setComplete(
                  `${format.toUpperCase()} ready · ${(blob.size / 1024 / 1024).toFixed(1)} MiB`,
                )
              } catch (error) {
                if (!abort.signal.aborted)
                  setError(
                    error instanceof Error ? error.message : 'Export failed. Try another format.',
                  )
              } finally {
                if (running.current === abort) {
                  running.current = null
                  setProgress(null)
                }
              }
            })()
          }}
        >
          <Download />
          Export video
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            downloadBlob(
              new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }),
              `${document.title}.motion.json`,
            )
          }
        >
          Project JSON
        </Button>
        {busy && (
          <IconButton
            size="sm"
            tooltip="Cancel export"
            aria-label="Cancel export"
            onClick={() => running.current?.abort()}
          >
            <X />
          </IconButton>
        )}
      </div>
      {progress !== null && (
        <div role="status" className="flex items-center gap-3 text-xs text-text-soft">
          <ProgressBar value={progress} aria-label="Rendering video" className="h-1.5 flex-1" />
          {Math.floor(progress)}%
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-status-error">
          {error}
        </p>
      )}
      {complete && (
        <p role="status" className="text-xs text-status-success">
          {complete}
        </p>
      )}
    </div>
  )
}
