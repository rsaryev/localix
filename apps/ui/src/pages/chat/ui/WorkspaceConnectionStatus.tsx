import { CircleAlert } from 'lucide-react'

import { runtimeErrorMessage, type RuntimeStatus } from '@/shared/lib/runtimeReady'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { IconButton } from '@localixai/kit/icon-button'
import { MetadataTooltip } from '@localixai/kit/tooltip'
import { shouldShowConnectionStatus } from '../model/connectionStatusVisibility'

export function WorkspaceConnectionStatus({
  hasHydrated,
  error,
  runtimeState,
  onRetry,
}: {
  hasHydrated: boolean
  error: unknown
  runtimeState: RuntimeStatus | undefined
  onRetry: () => void
}) {
  const visible = shouldShowConnectionStatus(hasHydrated, runtimeState)
  const runtimeError =
    runtimeState === 'error'
      ? (runtimeErrorMessage() ?? 'The local service could not start.')
      : null
  const failed = Boolean(runtimeError || error)
  const message = visible
    ? (runtimeError ??
      (error
        ? 'Workspace data could not be loaded'
        : runtimeState === 'starting'
          ? 'Starting the local service'
          : 'Connecting to the local service'))
    : ''
  const action = runtimeError ? 'Restart Localix' : 'Retry'

  // A transient row above the grid moves every pane at startup and on failure.
  // Keep the indicator in existing window chrome, but release its width when ready:
  // an empty reserved slot leaves a dead gap after the notification button.
  // The live region stays mounted so it can announce later failures.
  return (
    <div
      data-slot="workspace-connection-status"
      className={
        visible
          ? 'flex size-[var(--chrome-control-md)] shrink-0 items-center justify-center max-sm:size-[var(--chrome-control-touch)]'
          : 'sr-only'
      }
    >
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      {visible &&
        (failed ? (
          <IconButton
            size="md"
            className="text-status-error max-sm:size-[var(--chrome-control-touch)]"
            tone="danger"
            aria-label={`${message}. ${action}`}
            tooltip={`${message} — ${action}`}
            tooltipSide="bottom"
            onClick={onRetry}
          >
            <CircleAlert className="size-3.5" />
          </IconButton>
        ) : (
          <MetadataTooltip label={message} side="bottom">
            <span className="flex size-full items-center justify-center">
              <ActivityOrb className="size-3.5" />
            </span>
          </MetadataTooltip>
        ))}
    </div>
  )
}
