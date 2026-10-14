import { Network } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { StateNotice } from '@localixai/kit/state-notice'
import type { GraphSnapshot } from '../shared/view'

/** Before the first graph exists: progress while it builds, the reason and a retry if it failed. */
export function FirstBuild({
  snapshot,
  onRetry,
}: {
  snapshot: GraphSnapshot
  onRetry: () => void
}) {
  const { status } = snapshot
  if (status.state === 'failed') {
    return (
      <StateNotice
        icon={Network}
        title="The project could not be mapped"
        body={status.error}
        actions={
          <Button size="sm" variant="field" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    )
  }
  const progress = status.progress
  return (
    <StateNotice
      icon={Network}
      title={`Mapping ${snapshot.project}…`}
      body={
        <span className="flex flex-col items-center gap-2">
          <span>
            {progress && progress.total > 0
              ? `Parsed ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} files`
              : 'Finding source files'}
          </span>
          {progress && progress.total > 0 && (
            <ProgressBar
              value={(progress.done / progress.total) * 100}
              className="h-1 w-48"
              aria-label="Indexing progress"
            />
          )}
        </span>
      }
    />
  )
}
