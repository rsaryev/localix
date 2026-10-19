import { useState, type ReactNode, type SyntheticEvent } from 'react'
import { Pause, Play, RotateCw, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { IconButton } from '@localixai/kit/icon-button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { jobLine, type LocalModelState } from '@/shared/lib/localModelsFormat'

export interface LocalModelActions {
  onPause: () => void
  onResume: () => void
  /** Absent for a model Localix keeps on this computer: its download cannot be dropped. */
  onCancel?: () => void
  /** Absent for a model Localix keeps on this computer: it cannot be removed. */
  onRemove?: () => void
}

/** Controls inside a list row act on their own: the row's select must not fire under them. */
const own = (event: SyntheticEvent) => event.stopPropagation()

function Controls({ children }: { children: ReactNode }) {
  return (
    <span
      role="group"
      className="flex shrink-0 items-center gap-1"
      onClick={own}
      onPointerDown={own}
      onKeyDown={own}
    >
      {children}
    </span>
  )
}

/**
 * A local model's state once a download was asked for: progress with pause and cancel, a paused
 * download to resume or drop, a failure to retry, and an installed model to remove (confirmed).
 * A model Localix keeps here comes without cancel and remove.
 * Nothing for a model that is neither here nor coming — the row offers its download itself.
 */
export function LocalModelStatus({
  label,
  state,
  actions,
}: {
  label: string
  state: LocalModelState
  actions: LocalModelActions
}) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  switch (state.kind) {
    case 'available':
      return null
    case 'downloading':
      return (
        <Controls>
          <ProgressBar
            value={state.percent ?? 0}
            className="h-1 w-12"
            aria-label={`Downloading ${label}`}
            aria-valuenow={state.percent ?? undefined}
          />
          <span className="tabular-nums" title={jobLine(state.job)}>
            {state.job.phase === 'verifying'
              ? 'Verifying'
              : state.job.phase === 'queued'
                ? 'Queued'
                : `${state.percent ?? 0}%`}
          </span>
          <IconButton
            size="xs"
            aria-label="Pause download"
            tooltip="Pause"
            onClick={actions.onPause}
          >
            <Pause />
          </IconButton>
          {actions.onCancel && (
            <IconButton
              size="xs"
              aria-label="Cancel download"
              tooltip="Cancel and delete"
              onClick={actions.onCancel}
            >
              <X />
            </IconButton>
          )}
        </Controls>
      )
    case 'paused':
      return (
        <Controls>
          <span className="tabular-nums">Paused {state.percent ?? 0}%</span>
          <IconButton
            size="xs"
            aria-label="Resume download"
            tooltip="Resume"
            onClick={actions.onResume}
          >
            <Play />
          </IconButton>
          {actions.onCancel && (
            <IconButton
              size="xs"
              aria-label="Cancel download"
              tooltip="Cancel and delete"
              onClick={actions.onCancel}
            >
              <X />
            </IconButton>
          )}
        </Controls>
      )
    case 'failed':
      return (
        <Controls>
          <span className="truncate text-status-error" title={state.error}>
            Download failed
          </span>
          <IconButton
            size="xs"
            aria-label="Try again"
            tooltip="Try again"
            onClick={actions.onResume}
          >
            <RotateCw />
          </IconButton>
        </Controls>
      )
    case 'installed':
      return (
        <Controls>
          {state.running && <span className="text-status-success">Running</span>}
          {actions.onRemove && (
            <>
              <IconButton
                size="xs"
                aria-label={`Remove ${label}`}
                tooltip="Remove from this computer"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 />
              </IconButton>
              <ConfirmDialog
                open={confirmRemove}
                title={`Remove ${label}?`}
                description="Deletes its files from this computer. It can be downloaded again."
                confirmLabel="Remove"
                variant="destructive"
                onConfirm={() => {
                  setConfirmRemove(false)
                  actions.onRemove?.()
                }}
                onClose={() => setConfirmRemove(false)}
              />
            </>
          )}
        </Controls>
      )
  }
}
