import { useEffect, useState, type SVGProps } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

export type ActivityOrbState = 'thinking' | 'working'

export interface ActivityOrbProps extends SVGProps<SVGSVGElement> {
  state?: ActivityOrbState
}

/** Keep semantic status changes visual without changing the indicator's identity. */
export function activityOrbState(label: string): ActivityOrbState {
  return /think|reason|analy|plan|read|search|inspect|understand/i.test(label)
    ? 'thinking'
    : 'working'
}

export function cleanActivityLabel(label: string): string {
  return label.replace(/(?:\.\.\.|…)+$/u, '').trim() || 'Working'
}

/**
 * Localix's tiny dotted activity mark. Its geometry never remounts when the
 * agent changes phase; `data-state` only cross-fades the two orbit layers.
 */
export function ActivityOrb({ state = 'working', className, ...props }: ActivityOrbProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      data-state={state}
      className={cn('lx-activity-orb size-3.5 shrink-0 text-composer-accent', className)}
      {...props}
    >
      <circle className="lx-activity-orb__ghost" cx="10" cy="10" r="7.1" />
      <g className="lx-activity-orb__orbit lx-activity-orb__orbit--outer">
        <circle cx="10" cy="2.6" r="1.15" />
        <circle cx="16.4" cy="13.7" r="0.8" />
        <circle cx="3.6" cy="13.7" r="0.65" />
      </g>
      <g className="lx-activity-orb__orbit lx-activity-orb__orbit--inner">
        <circle cx="10" cy="5.1" r="0.8" />
        <circle cx="14.25" cy="12.45" r="0.62" />
        <circle cx="5.75" cy="12.45" r="0.62" />
      </g>
      <circle className="lx-activity-orb__core" cx="10" cy="10" r="1.25" />
    </svg>
  )
}

interface LabelLayers {
  current: string
  previous: string | null
}

/**
 * How long the outgoing label stays mounted: the length of its exit animation, which runs on
 * `--dur-base` (`.lx-activity-label-out`). Unmounting sooner cuts the fade off mid-way; later
 * leaves a finished, invisible layer in the grid cell.
 */
const LABEL_CROSSFADE_MS = 200

/** A fixed-slot label that keeps the old verb alive for a real cross-fade. */
function SmoothActivityLabel({ label, className }: { label: string; className?: string }) {
  const clean = cleanActivityLabel(label)
  const [layers, setLayers] = useState<LabelLayers>(() => ({ current: clean, previous: null }))

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the previous label is retained briefly for the exit half of the cross-fade.
    setLayers((prev) =>
      prev.current === clean ? prev : { current: clean, previous: prev.current },
    )
    const timer = window.setTimeout(() => {
      setLayers((prev) =>
        prev.previous && prev.current === clean ? { ...prev, previous: null } : prev,
      )
    }, LABEL_CROSSFADE_MS)
    return () => window.clearTimeout(timer)
  }, [clean])

  return (
    <span className={cn('relative grid min-w-[5.25rem] overflow-hidden', className)}>
      <span className="sr-only">{clean}</span>
      {layers.previous && (
        <span
          key={`out-${layers.previous}`}
          aria-hidden="true"
          className="lx-activity-label-out col-start-1 row-start-1 truncate"
        >
          {layers.previous}
        </span>
      )}
      <span
        key={`in-${layers.current}`}
        aria-hidden="true"
        className="lx-activity-label-in col-start-1 row-start-1 truncate"
      >
        {layers.current}
      </span>
    </span>
  )
}

/** Reusable one-line activity language for transcript and composer surfaces. */
export function ActivitySignal({
  label,
  className,
  labelClassName,
}: {
  label: string
  className?: string
  labelClassName?: string
}) {
  const clean = cleanActivityLabel(label)
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <ActivityOrb state={activityOrbState(clean)} />
      <SmoothActivityLabel label={clean} className={labelClassName} />
    </span>
  )
}
