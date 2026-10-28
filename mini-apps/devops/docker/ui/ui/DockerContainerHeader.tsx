import { Play, RotateCw, Square, TerminalSquare } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { DetailField } from '@localixai/kit/detail-field'
import { StatusDot } from '@localixai/kit/status-dot'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { formatResourceAge } from '../../../ui/model/resourceAge'
import { execIntoContainer } from '../model/execCommand'
import { stateDotClass } from '../model/groupContainers'
import type { DockerContainerTabModel } from '../model/useDockerContainerTab'

export function DockerContainerHeader({
  sessionId,
  model,
  containerId,
  fallbackName,
}: {
  /** The chat this container tab belongs to — where Exec opens its shell. */
  sessionId: string
  model: DockerContainerTabModel
  containerId: string
  fallbackName: string
}) {
  const displayName = model.container?.name ?? fallbackName
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-3 py-2">
        <StatusDot size="lg" className={stateDotClass(model.container?.state ?? 'exited')} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
          <span className="truncate text-2xs text-text-faint">
            {model.container?.image ?? containerId}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1 @max-sm:ml-0 @max-sm:w-full @max-sm:flex-wrap">
          {model.running && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Exec into container"
              title="Exec into container"
              onClick={() => void execIntoContainer(sessionId, containerId, displayName)}
            >
              <TerminalSquare className="size-3" />
              <span className="@max-sm:sr-only">Exec</span>
            </Button>
          )}
          {model.running ? (
            <>
              <ActionButton
                label="Stop container"
                disabled={model.busy}
                onClick={() => void model.runAction('stop')}
              >
                <Square className="size-3" />
              </ActionButton>
              <ActionButton
                label="Restart container"
                disabled={model.busy}
                onClick={() => void model.runAction('restart')}
              >
                <RotateCw className="size-3" />
              </ActionButton>
            </>
          ) : (
            <ActionButton
              label="Start container"
              disabled={model.busy || !model.container}
              onClick={() => void model.runAction('start')}
            >
              <Play className="size-3" />
            </ActionButton>
          )}
          <RefreshAction
            aria-label="Refresh"
            tooltip="Refresh"
            onClick={() =>
              void model.refresh(model.panel, model.panel === 'logs' && model.logsLive)
            }
          />
        </div>
      </div>

      <DevOpsProblem
        subject={`${displayName} actions`}
        issue={model.actionError}
        onDismiss={model.dismissActionError}
      />

      {model.container && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-border-soft px-3 py-2 text-xs">
          <DetailField label="Status" value={model.container.status} />
          <DetailField label="State" value={model.container.state} />
          <DetailField label="Ports" value={model.container.ports || '—'} />
          <DetailField
            label="Created"
            // The raw ISO stamp is unreadable at a glance and inconsistent with every
            // list column; the exact value stays available as the field's tooltip.
            value={formatResourceAge(model.container.createdAt) || '—'}
            title={model.container.createdAt}
          />
          {model.container.project && (
            <DetailField label="Compose" value={model.container.project} />
          )}
          {model.container.service && (
            <DetailField label="Service" value={model.container.service} />
          )}
        </div>
      )}
    </>
  )
}

function ActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="@max-sm:sr-only">{label.split(' ')[0]}</span>
    </Button>
  )
}
