import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Spinner } from '@localixai/kit/spinner'
import { Button } from '@localixai/kit/button'

/**
 * The Source Control panel's small icon action button — section-header bulk
 * actions (stage-all / unstage-all), PR header actions, branch row actions.
 * `danger` swaps the hover tint to the error palette; `spinning` replaces the icon
 * with the shared activity mark. Remaining button props (aria-label, title, …) spread
 * onto the <button>, so it composes with Radix `asChild` triggers (tooltips).
 */
export function BulkAction({
  danger,
  spinning,
  className,
  children,
  ...rest
}: ComponentPropsWithRef<'button'> & {
  danger?: boolean
  spinning?: boolean
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      {...rest}
      aria-label={rest['aria-label'] ?? rest.title}
      className={cn(
        'text-text-faint',
        danger
          ? 'hover:bg-status-error/15 hover:text-status-error'
          : 'hover:bg-surface-active hover:text-text-soft',
        className,
      )}
    >
      {spinning ? <Spinner size="xs" /> : children}
    </Button>
  )
}
