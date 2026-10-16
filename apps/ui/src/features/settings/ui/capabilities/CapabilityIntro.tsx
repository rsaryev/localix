import type { ReactNode } from 'react'
import { AttentionRollup } from '../AttentionRollup'

/**
 * A capability tab's action row: what needs attention, and what you can add.
 *
 * Every tab wrote this row for itself, and they had already drifted: some
 * collapsed to a column on a narrow settings pane and some did not, so on
 * exactly the tabs that forgot it the "Add …" button was squeezed against a
 * paragraph it should have dropped below. Stating the row once removes the
 * chance of a tab forgetting a rule the others follow.
 *
 * The lead PARAGRAPH is gone from it. Each tab opened with three to five sentences under
 * a page header that already carried a description, so every capability screen described
 * itself twice — and the half nobody needed was the long one. What survives as `children`
 * is a single line, for the one case that earns it: text that changes with the scope, and
 * so answers "whose rules am I looking at" rather than restating the tab's name.
 */
export function CapabilityIntro({
  children,
  attention,
  action,
}: {
  /** At most ONE short line, and only when it changes with the scope. Usually absent. */
  children?: ReactNode
  /** Error/warning counts, for registries that validate their records. */
  attention?: { errorCount: number; warningCount: number }
  /** Primary action(s) for this registry. Omitted while its form is open. */
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4 @max-md:flex-col">
      <div className="min-w-0 flex-1">
        {children && <p className="text-sm text-text-soft">{children}</p>}
        {attention && <AttentionRollup {...attention} />}
      </div>
      {action && (
        <div className="flex shrink-0 flex-wrap justify-end gap-2 @max-md:self-end">{action}</div>
      )}
    </div>
  )
}
