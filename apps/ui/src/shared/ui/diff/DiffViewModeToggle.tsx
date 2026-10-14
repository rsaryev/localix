import { Rows3, Columns2 } from 'lucide-react'
import { useDiffViewMode, type DiffViewMode } from './diffViewMode'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { FloatingActionGroup } from '@localixai/kit/workbench-toolbar'
import { IconButton } from '@localixai/kit/icon-button'

/**
 * Compact unified ⇄ split toggle for the diff surfaces. Shares the global
 * `useDiffViewMode` preference, so flipping it here re-renders every mounted
 * DiffView at once. Styled to match the floating hunk-navigator chip.
 */
export function DiffViewModeToggle({
  className,
  embedded = false,
}: {
  className?: string
  /** Render inside an existing toolbar without creating a second floating surface. */
  embedded?: boolean
}) {
  const [mode, setMode] = useDiffViewMode()
  const btn = (value: DiffViewMode, Icon: typeof Rows3, label: string) => (
    <IconButton
      size="xs"
      aria-label={label}
      aria-pressed={mode === value}
      tooltip={label}
      onClick={() => setMode(value)}
      // The pressed state is IconButton's own (`aria-pressed:bg-surface-active`); repainting it
      // here as a hover tint made this the one toggle whose selected option looked hovered.
      className="text-text-soft"
    >
      <Icon />
    </IconButton>
  )
  const actions = (
    <>
      {btn('unified', Rows3, 'Unified diff view')}
      {btn('split', Columns2, 'Split (side-by-side) diff view')}
    </>
  )

  if (embedded) {
    return (
      <div
        role="group"
        aria-label="Diff layout"
        className={cn('flex items-center gap-0.5 px-1 py-0.5 text-2xs', className)}
      >
        {actions}
      </div>
    )
  }

  return (
    <FloatingActionGroup
      aria-label="Diff layout"
      className={cn('gap-0.5 px-1 py-0.5 text-2xs', className)}
    >
      {actions}
    </FloatingActionGroup>
  )
}
