import { cva } from 'class-variance-authority'
import {
  cn,
  CONTROL_FOCUS_VISIBLE,
  CONTROL_INVALID,
  FIELD_SURFACE,
} from '@localixai/plugin-sdk/ui/classes'

/**
 * Physical scale shared by listbox-select and searchable-combobox triggers, named after the chrome
 * ladder rung like Button's: `md` 28 / `lg` 32 / `xl` 36.
 */
export type ChoiceControlSize = 'md' | 'lg' | 'xl'

/**
 * One visual contract for controls that reveal a single-choice popup.
 *
 * The popup implementation may differ (a listbox for short lists, a searchable
 * command list for long ones), but its closed trigger must not change geometry,
 * focus treatment, invalid state, or disabled affordance.
 */
export const choiceTriggerVariants = cva(
  cn(
    // The FIELD FILL, one veil shared by Input/Textarea/InputGroup/SearchInput/Checkbox and this
    // trigger: `bg-field-fill`. Two other fills were tried and both failed — `--surface-raised`
    // mixes from a ground darker than the pane, and `--input` is an opaque grey in the plain dark
    // theme, so either way a field read as a black bar. A foreground veil takes whatever the pane
    // is showing and only adds density, which is correct in every theme by construction.
    // A TOKEN rather than the alpha spelled out: it was hand-written as `bg-foreground/[0.04]` in
    // six primitives, and when one of them was retuned the other five silently stayed behind.
    FIELD_SURFACE,
    'flex items-center justify-between gap-1 transition-colors hover:border-control-border-hover disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    CONTROL_INVALID,
    CONTROL_FOCUS_VISIBLE,
  ),
  {
    variants: {
      size: {
        md: 'h-[var(--chrome-control-md)] px-2 text-xs',
        lg: 'h-[var(--chrome-control-lg)] px-2 text-xs',
        xl: 'h-[var(--chrome-control-xl)] px-3 text-sm',
      },
      placeholder: {
        true: 'text-text-faint',
        false: 'text-foreground',
      },
    },
    defaultVariants: {
      size: 'lg',
      placeholder: false,
    },
  },
)

export const choiceTriggerIconVariants = cva('shrink-0 text-text-faint', {
  variants: {
    size: {
      md: 'size-3',
      lg: 'size-3.5',
      xl: 'size-4',
    },
  },
  defaultVariants: {
    size: 'lg',
  },
})
