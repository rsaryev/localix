import type { ComponentPropsWithRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * Small pill badge for counts / short labels (e.g. "3 questions", a filter
 * count). One source of truth for the rounded-full chip styling that was
 * hand-rolled across the tool parts and board toolbars. `tabular-nums` keeps
 * numeric chips from jittering as the count changes.
 */
const chipVariants = cva('inline-flex items-center rounded-full px-1.5 text-2xs tabular-nums', {
  variants: {
    tone: {
      neutral: 'bg-surface-hover text-text-faint',
      // Slightly stronger count pill for section headers (Changes groups, Review
      // tab). Not CollapsibleSection: its count is quiet metadata beside the title
      // by design, and its test keeps it off a pill.
      active: 'bg-surface-active text-text-soft',
      // A short LABEL on the app's own foreground, not a status: the method gutter of a saved
      // request, a content type. Distinct from `active`, which reads as a selected count.
      accent: 'bg-foreground/10 text-foreground',
      info: 'bg-status-info/12 text-status-info',
      warning: 'bg-status-warning/12 text-status-warning',
      error: 'bg-status-error/12 text-status-error',
      success: 'bg-status-success/12 text-status-success',
    },
    // `dense` drops the vertical padding for chips that sit inline inside a
    // text run / button and take their height from the line (a toolbar filter,
    // tool-chain status). `default` is the standalone pill (Ask/Quiz).
    size: {
      default: 'py-0.5',
      dense: '',
      // Fixed-height numeric counter (unread bell badge, journal counts): stays a
      // circle for one digit and grows into a pill for "99+".
      counter: 'h-3.5 min-w-3.5 justify-center px-1 text-3xs leading-4',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'default' },
})

export function Chip({
  tone,
  size,
  className,
  ...rest
}: ComponentPropsWithRef<'span'> & VariantProps<typeof chipVariants>) {
  // Spreads native span props (title tooltips, aria-* on counters) and forwards
  // the ref so a Chip can sit directly under an asChild trigger (MetadataTooltip).
  return <span className={cn(chipVariants({ tone, size }), className)} {...rest} />
}
