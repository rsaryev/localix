import { RotateCcw } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { PICKER_ROW_LEADING, pickerRow } from './pickerRow'

/** "Use the fallback" entry heading a workload's model list. */
export function ResetRouteRow({
  selected,
  label,
  onReset,
}: {
  selected: boolean
  label: string
  onReset: () => void
}) {
  return (
    <button
      type="button"
      onClick={onReset}
      // A model row's measure, so the reset reads as the list's first entry, not a loose button.
      className={pickerRow(selected, 'mb-1')}
    >
      <span className={cn(PICKER_ROW_LEADING, 'text-text-faint')}>
        <RotateCcw className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

/**
 * The way back on, right where it is needed. Below md the workload switch lives in a sheet
 * behind the inert area, so a hint pointing at it alone was a dead end.
 */
export function WorkloadOffOverlay({
  label,
  onTurnOn,
}: {
  label: string | undefined
  onTurnOn?: () => void
}) {
  return (
    <div className="absolute inset-0 z-(--z-controls) flex flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-xs text-text-faint">{label} is off</p>
      {onTurnOn && (
        <Button variant="outline" size="sm" onClick={onTurnOn}>
          Turn on
        </Button>
      )}
    </div>
  )
}
