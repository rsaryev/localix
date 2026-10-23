import { AlertCircle, Focus, ListFilter } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Spinner } from '@localixai/kit/spinner'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'

/**
 * The chip shape over the canvas. `FLOATING_SURFACE` is the kit's one floating material: the
 * hand-rolled `bg-background/90` + border + shadow these chips used to transcribe skipped the
 * `lx-floating-surface` marker, so they missed the glass frost and the contrast/forced-colors
 * repairs every other floating chip in the app gets.
 */
const CHIP = cn(FLOATING_SURFACE, 'flex items-center gap-1.5 px-2 py-1 text-2xs')

/**
 * What floats over the relationship diagram: the table it is focused on, and how much of the
 * schema is still being read or failed to read. "Not here yet" is split into still-reading and
 * failed — it used to be one subtraction, so a failed introspection counted as in-flight and the
 * pill read "Reading 3 tables…" for the rest of the session with no way to retry.
 */
export function DiagramStatusChips({
  focusedTable,
  onShowAll,
  loadingTables,
  failedTables,
  onRetry,
  partialOf = null,
}: {
  focusedTable: string | null
  onShowAll: () => void
  loadingTables: number
  failedTables: readonly string[]
  onRetry: () => void
  /** The catalogue is above the diagram's eager cap: only a narrowed part of this many is read. */
  partialOf?: number | null
}) {
  return (
    <>
      {(focusedTable || partialOf !== null) && (
        <div className="absolute left-3 top-3 z-(--z-controls) flex flex-col items-start gap-1">
          {focusedTable && (
            <div className={CHIP}>
              <Focus className="size-3 text-status-info" />
              <span className="text-text-soft">
                Focused on <strong className="font-medium text-foreground">{focusedTable}</strong>
              </span>
              <button
                type="button"
                onClick={onShowAll}
                className="text-status-info outline-none hover:underline focus-ring"
              >
                Show all
              </button>
            </div>
          )}
          {partialOf !== null && (
            <div className={cn(CHIP, 'text-text-faint')}>
              <ListFilter className="size-3" />
              Part of {partialOf.toLocaleString()} tables — search names to read others
            </div>
          )}
        </div>
      )}
      {(loadingTables > 0 || failedTables.length > 0) && (
        <div className="absolute right-3 top-3 z-(--z-controls) flex flex-col items-end gap-1">
          {loadingTables > 0 && (
            <div className={cn(CHIP, 'text-text-faint')}>
              <Spinner className="size-3" />
              Reading {loadingTables} {loadingTables === 1 ? 'table' : 'tables'}…
            </div>
          )}
          {failedTables.length > 0 && (
            <button
              type="button"
              onClick={onRetry}
              title={failedTables.join(', ')}
              className={cn(
                CHIP,
                'text-text-soft outline-none transition-colors hover:text-foreground focus-ring',
              )}
            >
              <AlertCircle className="size-3 text-status-error/70" />
              {failedTables.length} {failedTables.length === 1 ? 'table' : 'tables'} unreadable —
              retry
            </button>
          )}
        </div>
      )}
    </>
  )
}
