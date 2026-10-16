import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import { fmtMs, rowCountLabel, TRUNCATED_HINT } from './format'

/** Compact status line: row count + query duration. The footer rule already separates this
 * metadata from the grid, so the status itself deliberately has no nested pill. It carries no
 * "Drag to chat" grip: the visible result reaches the chat on its own (`consoleContext.ts`).
 *
 * Bought from the shared status bar rather than measured here: this row closes the SQL
 * result pane, and the row that closes the sibling table pane (`TableDataWorkspace`) is a
 * `WorkbenchStatusBar`. Hand-rolled, this one stood at a content-derived height on a
 * lighter-than-chrome seam, so the two panes ended on different baselines and different
 * seam weights. One status-bar measure per pane bottom, one seam weight per junction. */
export function ResultFooter({
  shownRows,
  totalRows,
  truncated = false,
  durationMs,
}: {
  shownRows: number
  totalRows: number
  /** The engine returned more rows than the result cap; `totalRows` is the cap. */
  truncated?: boolean
  durationMs: number
}) {
  return (
    <WorkbenchStatusBar
      aria-label="Query result summary"
      className="relative justify-center text-text-soft"
    >
      <WorkbenchStatusItem className="gap-1.5">
        <span {...(truncated ? { title: TRUNCATED_HINT, className: 'text-status-warning' } : {})}>
          {rowCountLabel(shownRows, totalRows, truncated)}
        </span>
        <span aria-hidden className="text-text-faint">
          ·
        </span>
        <span className="text-text-faint">{fmtMs(durationMs)}</span>
      </WorkbenchStatusItem>
    </WorkbenchStatusBar>
  )
}
