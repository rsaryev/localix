import * as React from 'react'

import {
  cn,
  CONTROL_FOCUS_VISIBLE,
  CONTROL_INVALID,
  FIELD_SURFACE,
} from '@localixai/plugin-sdk/ui/classes'
import { useFieldControlProps } from './field'

type TextareaProps = React.ComponentPropsWithoutRef<'textarea'> & {
  /** Text scale and padding aligned with Input, under Input's names; height remains content-owned. */
  size?: 'md' | 'lg' | 'xl'
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, size = 'md', ...props },
  ref,
) {
  const controlProps = useFieldControlProps(props, true)
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        // Read-only = a THINNER veil, not `bg-surface-sunken`, exactly as in Input: sunken is a
        // black 45% veil under glass, which on a field-sized control read as a black slot.
        FIELD_SURFACE,
        'flex field-sizing-content min-h-16 max-h-[10lh] w-full resize-none overflow-y-auto px-2 py-2 text-xs/relaxed transition-colors placeholder:text-text-faint read-only:cursor-not-allowed read-only:bg-foreground/[0.02] disabled:cursor-not-allowed disabled:opacity-50 scrollbar-thin',
        CONTROL_INVALID,
        CONTROL_FOCUS_VISIBLE,
        size === 'xl'
          ? 'px-3 py-2.5 text-sm'
          : size === 'lg'
            ? 'px-2.5 py-2 text-xs/relaxed'
            : 'px-2 py-2 text-xs/relaxed',
        className,
      )}
      {...controlProps}
    />
  )
})

export { Textarea }
export type { TextareaProps }
