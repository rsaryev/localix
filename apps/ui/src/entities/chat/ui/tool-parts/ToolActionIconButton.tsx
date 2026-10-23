import type { ComponentType } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { IconButton } from '@localixai/kit/icon-button'

/**
 * One compact, native lifecycle control for tool rows. ToolLine owns event
 * isolation at the action-cluster boundary, so stop/retry/pause actions can use
 * the same IconButton contract as the rest of the workbench.
 */
export function ToolActionIconButton({
  icon: Icon,
  label,
  disabled,
  tone = 'neutral',
  filled,
  onClick,
}: {
  icon: ComponentType<{ className?: string; fill?: string }>
  label: string
  disabled?: boolean
  tone?: 'neutral' | 'danger'
  filled?: boolean
  onClick: () => void
}) {
  return (
    <IconButton
      aria-label={label}
      tooltip={label}
      tooltipSide="top"
      size="xs"
      tone={tone === 'danger' ? 'danger' : 'default'}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        tone === 'danger'
          ? 'hover:bg-status-error/15'
          : 'hover:bg-surface-hover hover:text-foreground',
      )}
    >
      <Icon className="size-2.5" fill={filled ? 'currentColor' : 'none'} />
    </IconButton>
  )
}
