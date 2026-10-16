import * as React from 'react'

import {
  cn,
  CONTROL_FOCUS_VISIBLE,
  CONTROL_INVALID,
  FIELD_SURFACE,
} from '@localixai/plugin-sdk/ui/classes'
import { useFieldControlProps } from './field'

const Input = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentPropsWithoutRef<'input'>, 'size'> & {
    /**
     * Control height, named after its rung on the chrome ladder exactly as Button and IconButton
     * name theirs: inline (`md`, 28px), ordinary form (`lg`, 32px), or focused decision form
     * (`xl`, 36px). These were `sm`/`md`/`lg`, so `size="sm"` meant 28px here and 24px on the
     * button beside it; the rename moved no pixel.
     */
    size?: 'md' | 'lg' | 'xl'
  }
>(({ className, type, size = 'md', ...props }, ref) => {
  const controlProps = useFieldControlProps(props, true)
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        // Read-only = a THINNER veil, not `bg-surface-sunken`: sunken is a black 45% veil under
        // glass, right for a pane-sized inset but on a field-sized control it read as a black
        // slot. One step below the editable fill says "not for typing" without going opaque.
        FIELD_SURFACE,
        'w-full min-w-0 px-2 py-0.5 text-xs/relaxed transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium file:text-foreground placeholder:text-text-faint read-only:cursor-not-allowed read-only:bg-foreground/[0.02] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        CONTROL_INVALID,
        CONTROL_FOCUS_VISIBLE,
        size === 'xl'
          ? 'h-[var(--chrome-control-xl)] px-3 text-sm'
          : size === 'lg'
            ? 'h-[var(--chrome-control-lg)]'
            : 'h-[var(--chrome-control-md)]',
        className,
      )}
      {...controlProps}
    />
  )
})
Input.displayName = 'Input'

export { Input }
