import type { ReactNode } from 'react'
import { Lightbulb } from 'lucide-react'
import { useDismissable } from '../lib/dismissable'
import { Button } from '../controls/button'
import { WorkbenchNoticeBar } from './workbench-notice-bar'

/**
 * A slim, one-shot teaching strip: shown the FIRST time the user is in the
 * context a feature applies to, gone for good once dismissed (or once its
 * optional action is taken). Backed by the shared `Dismissable` store, so the
 * dismissal is remembered across reloads and shared by every surface using the
 * same key.
 *
 * Presentation only — the caller owns WHEN it is relevant (`when`) and what the
 * action does. Renders nothing when it isn't relevant or has been dismissed.
 */
export function DismissibleHint({
  hintKey,
  when = true,
  icon,
  children,
  action,
  onAction,
  className,
}: {
  /** Stable key (use `HINT.*`) — the dismissal is remembered under it. */
  hintKey: string
  /** Whether the hint is relevant right now. False renders nothing (and doesn't dismiss). */
  when?: boolean
  icon?: ReactNode
  /** The hint copy. */
  children: ReactNode
  /** Optional primary action label (e.g. "Turn it on"). */
  action?: string
  /** Runs on action; the hint dismisses itself afterwards. */
  onAction?: () => void
  className?: string
}) {
  const { dismissed, dismiss } = useDismissable(hintKey)
  if (dismissed || !when) return null

  return (
    <WorkbenchNoticeBar
      role="note"
      icon={icon ?? <Lightbulb className="size-3.5" />}
      title={children}
      className={className}
      actionsLabel="Hint actions"
      actions={
        action && onAction ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              onAction()
              dismiss()
            }}
          >
            {action}
          </Button>
        ) : undefined
      }
      onDismiss={dismiss}
      dismissLabel="Dismiss tip"
    />
  )
}
