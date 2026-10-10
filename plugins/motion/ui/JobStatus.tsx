import { useState } from 'react'
import { AlertTriangle, Wrench } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { Spinner } from '@localixai/kit/spinner'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import type { MotionJob, MotionLibrary } from '../shared/contract'

const RUNNING: Record<MotionJob['kind'], string> = {
  render: 'Rendering video',
  snapshot: 'Taking snapshots',
  check: 'Checking the film',
}
const FAILED: Record<MotionJob['kind'], string> = {
  render: 'Render failed',
  snapshot: 'Snapshots failed',
  check: 'Check failed',
}

/** The project's background job: progress while it runs, the CLI's reason when it fails. */
export function JobStatus({
  job,
  cancelling,
  onCancel,
}: {
  job: MotionJob | null
  cancelling: boolean
  onCancel: () => void
}) {
  // A failure stays on the server until the next job; hiding it is the viewer's own choice.
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!job || job.state === 'done') return null
  if (job.state === 'failed')
    return dismissed === job.startedAt ? null : (
      <WorkbenchNoticeBar
        role="alert"
        tone="error"
        layout="stacked"
        icon={<AlertTriangle className="size-3.5" />}
        title={FAILED[job.kind]}
        description={job.message || 'The HyperFrames CLI stopped without a reason.'}
        onDismiss={() => setDismissed(job.startedAt)}
        dismissLabel="Dismiss failure"
      />
    )
  const progress = job.progress === null ? null : Math.round(job.progress)
  return (
    <div role="status" aria-live="polite" className="shrink-0">
      <WorkbenchNoticeBar
        tone="info"
        icon={<Spinner />}
        title={progress === null ? RUNNING[job.kind] : `${RUNNING[job.kind]} · ${progress}%`}
        description={job.message || undefined}
        actionsLabel="Job actions"
        actions={
          <Button size="xs" variant="ghost" disabled={cancelling} onClick={onCancel}>
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        }
        className="border-b-0"
      />
      <ProgressBar
        value={progress ?? 0}
        aria-label={RUNNING[job.kind]}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
        aria-valuetext={progress === null ? 'Starting' : `${progress}%`}
        className="h-0.5 rounded-none"
        fillClassName="rounded-none bg-status-info"
      />
    </div>
  )
}

/** Snapshot and render shell out to the HyperFrames CLI, which needs Node and FFmpeg. */
export function ToolingNotice({ tooling }: { tooling: MotionLibrary['tooling'] }) {
  if (tooling.node && tooling.ffmpeg) return null
  const missing = [!tooling.node && 'Node.js 22 or newer', !tooling.ffmpeg && 'FFmpeg'].filter(
    Boolean,
  )
  return (
    <WorkbenchNoticeBar
      role="note"
      tone="warning"
      layout="stacked"
      icon={<Wrench className="size-3.5" />}
      title="Rendering needs local tools"
      description={`Install ${missing.join(' and ')}, then reopen Motion Studio. The first render also downloads a headless Chrome. The live preview works without them.`}
    />
  )
}
