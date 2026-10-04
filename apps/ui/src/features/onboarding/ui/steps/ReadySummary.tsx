import { cn } from '@localixai/plugin-sdk/ui/classes'
import { TextAction } from '@localixai/kit/text-action'

export interface ReadySummaryRow {
  label: string
  value: string
  /** Render the value as code — model ids and fonts read as identifiers. */
  mono?: boolean
  /** Step to reopen when the user wants to change this. Omit for read-only rows. */
  changeStepId?: string
}

/**
 * The activation read-back: every choice onboarding just made, each with a way
 * straight back to the step that owns it.
 *
 * The last step used to state only whether a model was wired, which meant the
 * other choices (theme, typography) vanished silently and a wrong one cost a
 * hunt through Settings. Listing them with a "Change" link makes the summary a
 * review screen rather than a receipt.
 */
export function ReadySummary({
  rows,
  onJumpTo,
}: {
  rows: ReadySummaryRow[]
  onJumpTo: (stepId: string) => void
}) {
  return (
    <dl className="w-full divide-y divide-border-faint">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline gap-4 py-2">
          <dt className="w-28 shrink-0 text-xs text-text-faint">{row.label}</dt>
          <dd
            className={cn(
              'min-w-0 flex-1 truncate text-xs font-medium text-foreground',
              row.mono && 'font-mono',
            )}
          >
            {row.value}
          </dd>
          {row.changeStepId && (
            <TextAction
              onClick={() => onJumpTo(row.changeStepId!)}
              className="shrink-0 text-2xs font-medium text-text-faint hover:text-foreground"
            >
              Change
            </TextAction>
          )}
        </div>
      ))}
    </dl>
  )
}
