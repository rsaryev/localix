import * as React from 'react'

import { cn, CONTROL_FOCUS_VISIBLE } from '@localixai/mini-app-sdk/ui/classes'

type SliderProps = Omit<
  React.ComponentPropsWithoutRef<'input'>,
  'type' | 'value' | 'defaultValue' | 'min' | 'max' | 'step' | 'onChange'
> & {
  /** The named stops, left to right; the value is the index of one. */
  steps: readonly string[]
  value: number
  onValueChange: (index: number) => void
}

/** The thumb, spelt out per engine: Tailwind only sees classes written in full. */
const THUMB = [
  '[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-background-solid [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-(--shadow-raised) [&::-webkit-slider-thumb]:transition-transform motion-reduce:[&::-webkit-slider-thumb]:transition-none active:[&::-webkit-slider-thumb]:scale-110',
  '[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-background-solid [&::-moz-range-thumb]:bg-foreground',
]

/**
 * A native range over named stops (Fastest … Smartest): the track fills to the thumb, a tick
 * marks every stop, and each stop's label sits under it — the chosen one in the foreground,
 * the others a click away. Arrow keys move one stop. For a choice among a few equal options
 * use `TogglePill`s; a slider is for a scale where the stops are ordered.
 */
const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ steps, value, onValueChange, className, disabled, ...props }, ref) => {
    const last = Math.max(1, steps.length - 1)
    const fill = `${(value / last) * 100}%`
    return (
      <div data-slot="slider" className={cn('w-full space-y-1.5', className)}>
        <div className="relative flex h-4 items-center">
          {/* The ticks sit under the track's ends and stops, inset by half a thumb. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-1.75 flex justify-between"
          >
            {steps.map((step, index) => (
              <span
                key={step}
                className={cn(
                  'size-1 rounded-full',
                  index <= value ? 'bg-foreground' : 'bg-control-border-hover',
                )}
              />
            ))}
          </div>
          <input
            {...props}
            ref={ref}
            type="range"
            min={0}
            max={last}
            step={1}
            value={value}
            disabled={disabled}
            aria-valuetext={steps[value]}
            onChange={(event) => onValueChange(Number(event.currentTarget.value))}
            style={{ '--slider-fill': fill } as React.CSSProperties}
            className={cn(
              'relative h-1 w-full cursor-pointer appearance-none rounded-full bg-[linear-gradient(to_right,var(--color-foreground)_var(--slider-fill),var(--color-control-border)_var(--slider-fill))] disabled:cursor-not-allowed disabled:opacity-50',
              THUMB,
              CONTROL_FOCUS_VISIBLE,
            )}
          />
        </div>
        <div className="flex justify-between text-2xs">
          {steps.map((step, index) => (
            <button
              key={step}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => onValueChange(index)}
              className={cn(
                'select-none transition-colors motion-reduce:transition-none',
                index === value
                  ? 'font-medium text-foreground'
                  : 'text-text-faint hover:text-text-soft',
              )}
            >
              {step}
            </button>
          ))}
        </div>
      </div>
    )
  },
)
Slider.displayName = 'Slider'

export { Slider }
export type { SliderProps }
