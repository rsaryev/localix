import * as React from 'react'

import { cn, CONTROL_FOCUS_VISIBLE, CONTROL_INVALID } from '@localixai/mini-app-sdk/ui/classes'
import { useFieldControlProps } from './field'

type SwitchSize = 'sm' | 'md'

type SwitchProps = Omit<
  React.ComponentPropsWithoutRef<'input'>,
  'checked' | 'defaultChecked' | 'size' | 'type'
> & {
  /** Switches represent an immediate, controlled on/off setting. */
  checked: boolean
  /** Compact inline (`sm`) or ordinary settings (`md`) geometry. */
  size?: SwitchSize
}

/**
 * Native, form-capable on/off switch. Keep choice chips on `TogglePill` and
 * checkbox-style multi-selection on `Checkbox`; this primitive owns immediate
 * boolean settings across the host and mini app UI.
 */
const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, className, size = 'md', ...props }, ref) => {
    const controlProps = useFieldControlProps(props, true)

    return (
      <input
        {...controlProps}
        ref={ref}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        data-slot="switch"
        data-size={size}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer appearance-none items-center rounded-full border border-transparent bg-control-border transition-[background-color,border-color,box-shadow] after:pointer-events-none after:block after:translate-x-0.5 after:rounded-full after:bg-background-solid after:shadow-(--shadow-raised) after:transition-transform after:content-[''] checked:bg-foreground hover:bg-control-border-hover checked:hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:after:transition-none forced-colors:appearance-auto",
          CONTROL_INVALID,
          size === 'sm'
            ? 'h-4 w-7 after:size-3 checked:after:translate-x-3'
            : 'h-5 w-9 after:size-4 checked:after:translate-x-4',
          CONTROL_FOCUS_VISIBLE,
          className,
        )}
      />
    )
  },
)
Switch.displayName = 'Switch'

export { Switch }
export type { SwitchProps, SwitchSize }
