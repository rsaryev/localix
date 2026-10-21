import { memo, useState } from 'react'
import { CircleAlert, GitFork, Play, RefreshCw, X } from 'lucide-react'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { useCountdown } from '@/shared/hooks/useCountdown'
import type { SessionLoopSummary } from '@/shared/api/contracts'
import { Spinner } from '@localixai/kit/spinner'
import { IconButton } from '@localixai/kit/icon-button'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowLeading,
} from '@localixai/kit/workbench-list-row'
// Shared cadence formatter — the backend-owned source of truth, not a local copy.
import {
  loopCadenceLabel as cadenceLabel,
  loopHoldLabel,
  loopLastStatusLabel,
  loopPreview,
} from '@localixai/api/loops-format'

/**
 * Composer strip showing the active session loops for the current chat.
 * One row per loop: interval label, live next-run countdown, truncated prompt,
 * and direct run/cancel actions. Renders nothing when there are no active loops.
 *
 * Visual language mirrors WorkStrip — compact, theme-token styled.
 */

export function LoopRunMetadata({
  subsession,
  runCount,
  failed,
  title,
}: {
  subsession: boolean
  runCount: number
  failed: boolean
  title?: string
}) {
  return (
    <>
      {subsession && (
        <span
          className="flex shrink-0 items-center gap-1 text-2xs text-text-faint"
          title="Each fire runs in a fresh subsession"
        >
          <GitFork className="size-3" aria-hidden="true" />
          sub
        </span>
      )}
      {runCount > 0 && (
        <span
          className={`flex shrink-0 items-center gap-1 text-2xs ${failed ? 'text-status-error' : 'text-text-faint'}`}
          title={title}
        >
          <span>×{runCount}</span>
          {failed && <CircleAlert className="size-3" aria-label="Last run failed" />}
        </span>
      )}
    </>
  )
}

function LoopRow({ loop, onCancel }: { loop: SessionLoopSummary; onCancel: (id: string) => void }) {
  const countdown = useCountdown(loop.nextRunAt)
  // Recomputed on the same tick as the countdown so a lapsing hold disappears on its own.
  const hold = loopHoldLabel(loop, Date.now())
  const [cancelling, setCancelling] = useState(false)
  const [running, setRunning] = useState(false)
  const busy = cancelling || running
  const preview = loopPreview(loop)

  const cancel = async () => {
    if (busy) return
    setCancelling(true)
    try {
      const removed = await backendClient.cancelSessionLoop(loop.id)
      if (removed) onCancel(loop.id)
    } catch (err) {
      // The server publishes session_triggers.updated on success. On failure the button used to
      // just re-enable itself — a click that visibly did nothing, with no reason anywhere.
      toast.error('Could not cancel this loop', {
        description: errorMessage(err, '') || undefined,
      })
    } finally {
      setCancelling(false)
    }
  }

  const runNow = async () => {
    if (busy) return
    setRunning(true)
    try {
      // Fire an EXTRA occurrence now — the fixed loop's cron slot is untouched.
      await backendClient.runSessionLoop(loop.id)
    } catch (err) {
      toast.error('Could not run this loop now', {
        description: errorMessage(err, '') || undefined,
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <WorkbenchListRow density="dense">
      {/* Cadence icon + label */}
      <WorkbenchListRowLeading>
        <RefreshCw className="size-3.5" />
      </WorkbenchListRowLeading>
      <span className="shrink-0 text-xs font-medium leading-tight text-text-strong">
        {cadenceLabel(loop)}
      </span>

      {/* Next run countdown — or WHY it is not running. A held loop showed a normal countdown
          that restarted each tick while nothing fired, so the hold has to win this slot. */}
      {hold ? (
        <span
          className="shrink-0 text-2xs text-status-warning"
          title="The provider allowance for this session is exhausted; scheduled runs resume automatically"
        >
          {hold}
        </span>
      ) : (
        <span className="shrink-0 tabular-nums text-2xs text-text-faint">{countdown}</span>
      )}

      {/* Fire target + run stats */}
      <LoopRunMetadata
        subsession={loop.target === 'subsession'}
        runCount={loop.runCount}
        failed={loop.lastStatus === 'error'}
        title={
          loop.lastRunAt
            ? `Last run ${new Date(loop.lastRunAt).toLocaleString()} — ${loopLastStatusLabel(loop)}`
            : undefined
        }
      />

      {/* Prompt preview */}
      <span
        className="min-w-0 flex-1 truncate text-xs leading-tight text-text-soft"
        title={preview}
      >
        {preview}
      </span>

      <WorkbenchListRowActions aria-label={`${preview.slice(0, 40)} loop actions`}>
        {/* Run now adds an occurrence without changing the scheduled slot. */}
        <IconButton
          size="md"
          disabled={busy}
          onClick={() => void runNow()}
          aria-label={`Run loop now: ${preview.slice(0, 40)}`}
          tooltip={
            running
              ? 'Running loop…'
              : cancelling
                ? 'Run unavailable while cancelling'
                : 'Run loop now (extra occurrence)'
          }
          tooltipSide="top"
          // No hover override: IconButton's own `hover:bg-surface-hover` is the 7% veil. `accent`
          // is itself a 6% veil under glass, so `/12` of it was a 0.7% fill and `text-accent`
          // was near-invisible text — the button lost its hover feedback entirely.
        >
          {running ? <Spinner size="xs" /> : <Play className="size-3" />}
        </IconButton>
        <IconButton
          size="md"
          tone="danger"
          disabled={busy}
          onClick={() => void cancel()}
          aria-label={`Cancel loop: ${preview.slice(0, 40)}`}
          tooltip={
            cancelling
              ? 'Cancelling loop…'
              : running
                ? 'Cancel unavailable while running'
                : 'Cancel loop'
          }
          tooltipSide="top"
          className="hover:bg-status-error/12"
        >
          {cancelling ? <Spinner size="xs" /> : <X className="size-3" />}
        </IconButton>
      </WorkbenchListRowActions>
    </WorkbenchListRow>
  )
}

/**
 * Memoized: `loops` is the session's own array from the store and `onCancel` is
 * unset here, so the rows re-render only when the loop set actually changes.
 */
export const SchedulesPanel = memo(function SchedulesPanel({
  loops,
  onCancel,
}: {
  loops: SessionLoopSummary[]
  onCancel?: (id: string) => void
}) {
  if (loops.length === 0) return null

  return (
    <div className="border-b border-border-soft px-3.5 py-1">
      {loops.map((loop) => (
        <LoopRow key={loop.id} loop={loop} onCancel={onCancel ?? (() => {})} />
      ))}
    </div>
  )
})
