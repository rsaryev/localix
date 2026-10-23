import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { layoutTimeframes, timeframeLabel, timeframeTitle } from '../model/timeframeBar'

/**
 * The chart's timeframe toolbar — a thin, left-aligned row of BARE text buttons sitting directly
 * above the canvas (not in the quote header, which carries prices). The common timeframes show
 * inline; the rest fold behind a chevron dropdown. The active one is emphasised; there are no boxed
 * segments or per-item borders.
 *
 * Everything is derived from the venue's own `timeframes`, so a button we render is always one the
 * venue answers (`layoutTimeframes` + `timeframeLabel` are pure + tested). Fully keyboard reachable.
 */
export function TimeframeBar({
  timeframes,
  preferred,
  timeframe,
  onTimeframe,
}: {
  timeframes: string[]
  /** Common timeframes to surface inline (only those the venue supports appear). */
  preferred: string[]
  timeframe: string
  onTimeframe: (tf: string) => void
}) {
  const [open, setOpen] = useState(false)
  const { inline, overflow } = useMemo(
    () => layoutTimeframes(timeframes, preferred),
    [timeframes, preferred],
  )

  if (timeframes.length === 0) return null

  // If the active timeframe is not one of the inline buttons, it lives in the dropdown — surface it
  // ON the chevron trigger so the current selection is always visible.
  const activeInInline = inline.includes(timeframe)
  const overflowActive = !activeInInline && overflow.includes(timeframe)

  return (
    <WorkbenchToolbar density="compact" aria-label="Timeframe" className="gap-0.5 px-3">
      {inline.map((tf) => (
        <TfButton
          key={tf}
          active={tf === timeframe}
          onClick={() => onTimeframe(tf)}
          title={timeframeTitle(tf)}
        >
          {timeframeLabel(tf)}
        </TfButton>
      ))}

      {overflow.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="More timeframes"
              aria-expanded={open}
              className={cn(
                'flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-xs tabular-nums outline-none transition-colors hover:bg-surface-hover focus-ring',
                overflowActive
                  ? 'font-medium text-foreground'
                  : 'text-text-soft hover:text-foreground',
              )}
            >
              <span title={overflowActive ? timeframeTitle(timeframe) : undefined}>
                {overflowActive ? timeframeLabel(timeframe) : ''}
              </span>
              <ChevronDown className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto min-w-24 p-1">
            <div className="grid grid-cols-3 gap-0.5">
              {overflow.map((tf) => (
                <TfButton
                  key={tf}
                  active={tf === timeframe}
                  onClick={() => {
                    onTimeframe(tf)
                    setOpen(false)
                  }}
                  className="justify-center"
                  title={timeframeTitle(tf)}
                >
                  {timeframeLabel(tf)}
                </TfButton>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </WorkbenchToolbar>
  )
}

/** One bare timeframe button. Active = emphasised text; no box, no border. */
function TfButton({
  active,
  onClick,
  className,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  className?: string
  /** The timeframe spelled out — `1m` and `1M` differ only by case, so a bare label never says
   *  whether it means a minute or a month. */
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      aria-label={title}
      className={cn(
        'flex items-center rounded-sm px-1.5 py-0.5 text-xs tabular-nums outline-none transition-colors hover:bg-surface-hover focus-ring',
        active ? 'font-medium text-foreground' : 'text-text-soft hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}
