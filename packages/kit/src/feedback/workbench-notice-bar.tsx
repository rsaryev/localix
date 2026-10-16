import type { ComponentProps, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { IconButton } from '../controls/icon-button'
import { STATUS_TEXT_CLASS } from './status-tone'

/** The status palette's own text colours, plus the quiet neutral a notice without a signal uses. */
const ICON_TONE = { neutral: 'text-text-faint', ...STATUS_TEXT_CLASS } as const

type WorkbenchNoticeTone = keyof typeof ICON_TONE
type WorkbenchNoticeLayout = 'inline' | 'stacked'

type WorkbenchNoticeBarProps = Omit<ComponentProps<'div'>, 'title'> & {
  /** Signal colour belongs to the glyph; the structural surface stays neutral and quiet. */
  tone?: WorkbenchNoticeTone
  /** Every workbench notice starts with one decorative, semantically redundant signal glyph. */
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  actionsLabel?: string
  onDismiss?: () => void
  dismissLabel?: string
  /** Multi-line lifecycle explanations keep their actions below the copy. */
  layout?: WorkbenchNoticeLayout
}

/**
 * Compact in-flow notice chrome for workbench, composer, and contributed panels.
 *
 * This primitive owns only geometry and slots. It deliberately does not infer
 * `alert`, `status`, `note`, or live-region behaviour from its visual tone: the
 * caller that owns the event also owns its announcement semantics.
 */
export function WorkbenchNoticeBar({
  tone = 'neutral',
  icon,
  title,
  description,
  actions,
  actionsLabel = 'Notice actions',
  onDismiss,
  dismissLabel = 'Dismiss notice',
  layout = 'inline',
  className,
  ...props
}: WorkbenchNoticeBarProps) {
  const stacked = layout === 'stacked'

  return (
    <div
      data-slot="workbench-notice-bar"
      data-tone={tone}
      data-layout={layout}
      className={cn(
        // Foreground veil, not `bg-background`: as a nested ground coat this silently vanished
        // inside a pane (the once-only rule clears it) and read as a dark band inside a popover,
        // where the pane ground is denser than the popover's. A veil is one band everywhere.
        'shrink-0 border-b border-border-soft bg-foreground/[0.04] px-3 text-2xs text-text-soft',
        stacked
          ? 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 py-2'
          : 'flex min-h-[var(--chrome-control-lg)] flex-wrap items-center gap-x-2 gap-y-1 py-1',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('flex shrink-0', stacked && 'mt-0.5', ICON_TONE[tone])}
      >
        {icon}
      </span>

      <div
        className={cn(
          'min-w-0 flex-1',
          stacked ? 'flex flex-col gap-1' : 'flex items-baseline gap-1.5',
        )}
      >
        <span className="min-w-0 font-medium leading-snug text-text-soft">{title}</span>
        {description != null && (
          <span className={cn('min-w-0 text-text-faint', stacked ? 'leading-relaxed' : 'truncate')}>
            {description}
          </span>
        )}
      </div>

      {actions != null && (
        <div
          role="group"
          aria-label={actionsLabel}
          className={cn(
            'flex max-w-full flex-wrap items-center gap-1.5',
            stacked ? 'col-start-2 row-start-2 w-full' : 'ml-auto',
          )}
        >
          {actions}
        </div>
      )}

      {onDismiss && (
        <IconButton
          size="xs"
          onClick={onDismiss}
          aria-label={dismissLabel}
          tooltip={dismissLabel}
          className={cn(stacked && 'col-start-3 row-start-1')}
        >
          <X className="size-3" />
        </IconButton>
      )}
    </div>
  )
}

export type { WorkbenchNoticeBarProps, WorkbenchNoticeLayout, WorkbenchNoticeTone }
