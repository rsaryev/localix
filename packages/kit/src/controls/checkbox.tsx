import * as React from 'react'

import { cn, CONTROL_FOCUS_VISIBLE, CONTROL_INVALID } from '@localixai/plugin-sdk/ui/classes'
import { useFieldControlProps } from './field'

type CheckboxProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'type'> & {
  /** Render and expose the native mixed state used by partial bulk selections. */
  indeterminate?: boolean
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

/**
 * Compact native checkbox for forms and inline choices. The visual treatment is
 * app-owned, while the input keeps browser form, keyboard, label, and validation
 * behavior. Use `Switch` for a larger immediate on/off setting.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate = false, ...props }, forwardedRef) => {
    const controlProps = useFieldControlProps(props, true)
    const inputRef = React.useRef<HTMLInputElement | null>(null)
    const indeterminateRef = React.useRef(indeterminate)
    indeterminateRef.current = indeterminate
    const setInputRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node
        if (node) node.indeterminate = indeterminateRef.current
        assignRef(forwardedRef, node)
      },
      [forwardedRef],
    )

    React.useLayoutEffect(() => {
      if (inputRef.current) inputRef.current.indeterminate = indeterminate
    }, [indeterminate])

    return (
      <input
        {...controlProps}
        ref={setInputRef}
        type="checkbox"
        data-slot="checkbox"
        aria-checked={indeterminate ? 'mixed' : controlProps['aria-checked']}
        className={cn(
          "relative inline-grid size-4 shrink-0 cursor-pointer appearance-none place-content-center rounded-sm border border-control-border bg-field-fill text-background transition-[background-color,border-color,box-shadow] before:block before:size-2.5 before:scale-0 before:bg-current before:content-[''] before:[clip-path:polygon(14%_44%,0_65%,50%_100%,100%_16%,80%_0%,43%_62%)] checked:border-foreground checked:bg-foreground checked:before:scale-100 checked:hover:border-foreground indeterminate:border-foreground indeterminate:bg-foreground indeterminate:before:h-0.5 indeterminate:before:w-2 indeterminate:before:scale-100 indeterminate:before:rounded-full indeterminate:before:[clip-path:none] hover:border-control-border-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none forced-colors:appearance-auto",
          CONTROL_INVALID,
          CONTROL_FOCUS_VISIBLE,
          className,
        )}
      />
    )
  },
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
export type { CheckboxProps }
