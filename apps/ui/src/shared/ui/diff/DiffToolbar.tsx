import { ChevronDown, ChevronUp } from 'lucide-react'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { IconButton } from '@localixai/kit/icon-button'
import { MetadataTooltip } from '@localixai/kit/tooltip'
import { DiffViewModeToggle } from './DiffViewModeToggle'
import type { ReactNode } from 'react'

/**
 * Reserved chrome above every diff surface, so layout and navigation never cover a
 * code line. One arrangement everywhere — what the diff IS on the left (`lead`),
 * what you can DO on the right (change stepper, host actions, the layout toggle) —
 * where the single-file, multi-file and staging views used to put the toggle in
 * three different places.
 */
export function DiffToolbar({
  lead,
  showModeToggle = true,
  current,
  total,
  onNavigate,
  actions,
}: {
  lead?: ReactNode
  showModeToggle?: boolean
  current: number
  total: number
  onNavigate: (index: number) => void
  actions?: ReactNode
}) {
  return (
    <WorkbenchToolbar density="slim" aria-label="Diff controls">
      {lead && (
        <span className="flex min-w-0 items-center gap-2 truncate text-2xs text-text-faint">
          {lead}
        </span>
      )}
      <WorkbenchToolbarSection align="end" spacing="compact">
        {total > 1 && (
          <div
            role="group"
            aria-label="Diff change navigation"
            className="flex items-center gap-0.5"
          >
            <IconButton
              size="xs"
              aria-label="Previous change"
              tooltip="Previous change (k / Shift+F7)"
              onClick={() => onNavigate(current - 1)}
            >
              <ChevronUp />
            </IconButton>
            <MetadataTooltip label={`Change ${current + 1} of ${total}`}>
              <span
                role="status"
                className="px-1 text-2xs text-text-soft tabular-nums"
                aria-label={`Change ${current + 1} of ${total}`}
              >
                {current + 1}/{total}
              </span>
            </MetadataTooltip>
            <IconButton
              size="xs"
              aria-label="Next change"
              tooltip="Next change (j / F7)"
              onClick={() => onNavigate(current + 1)}
            >
              <ChevronDown />
            </IconButton>
          </div>
        )}
        {actions}
        {showModeToggle && <DiffViewModeToggle embedded />}
      </WorkbenchToolbarSection>
    </WorkbenchToolbar>
  )
}
