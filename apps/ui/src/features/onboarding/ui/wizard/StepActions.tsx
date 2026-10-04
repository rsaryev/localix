import type { ReactNode } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { TextAction } from '@localixai/kit/text-action'

/**
 * The action block a step ends with — ONE standardized primary button plus an
 * optional quiet secondary link under it.
 *
 * Each step owns its own primary action (the wizard shell deliberately has no
 * global footer — a shared footer read as foreign and left the steps feeling
 * empty). That freedom let the buttons drift apart: different min widths and
 * alignments per step, so the eye had to re-find the primary action on every
 * page. This keeps the size/spacing in one place while each step still decides
 * its own label, alignment, and enabled state.
 */
export function StepActions({
  children,
  onClick,
  disabled,
  align = 'center',
  secondary,
  className,
}: {
  /** Primary button content — label plus whichever icon the step wants. */
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  /** `end` right-aligns in wide (list-heavy) steps; centered heroes use `center`. */
  align?: 'center' | 'end'
  /** Quiet escape action, e.g. "Finish without a model". */
  secondary?: { label: string; onClick: () => void }
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-3',
        align === 'end' ? 'items-stretch sm:items-end' : 'items-center',
        className,
      )}
    >
      <Button
        variant="mono"
        size="xl"
        className="w-full sm:w-auto sm:min-w-[16rem] sm:px-10"
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
      {secondary && (
        <TextAction
          onClick={secondary.onClick}
          className="text-xs font-medium text-text-faint hover:text-text-soft"
        >
          {secondary.label}
        </TextAction>
      )}
    </div>
  )
}
