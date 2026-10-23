import { createContext, useContext, useId, useMemo } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** Shared track and selection treatments for action and radio segments. */
export type SegmentedVariant = 'raised' | 'muted' | 'ghost' | 'outlined'

const SegCtx = createContext<{ variant: SegmentedVariant; fullWidth: boolean }>({
  variant: 'raised',
  fullWidth: false,
})

// Every track is a foreground VEIL: under the host's glass theme the ground tokens mix from a
// DARKER ground than the pane a toolbar sits on, so a track painted from one read as a black bar.
const TRACK: Record<SegmentedVariant, string> = {
  raised: 'bg-surface-hover/60',
  // `/40` of a 6% veil is 2.4% — below the threshold where the track reads at all, and the fill
  // is the only thing separating it from the pane. One step quieter than `raised`, still visible.
  muted: 'bg-muted/60',
  ghost: 'bg-transparent',
  // An inset ring preserves the sm/lg control geometry; a real border would
  // steal two pixels from the content box and make fixed-height items overflow.
  // Veil, not `bg-surface-raised/40`: raised DARKENS whatever it covers, so the outlined track
  // read as a dark trough under glass. The ring already draws the boundary.
  outlined: 'bg-foreground/[0.03] ring-1 ring-inset ring-border/60',
}

/**
 * Track and item heights on the workbench control scale (`--chrome-control-*`
 * in the host stylesheet), so a segmented control lines up with the Buttons and
 * Inputs beside it in a toolbar instead of approximating their height.
 *
 * The `p-0.5` track padding is what relates the two rows: an item is exactly one
 * rung below its track (24→20, 32→28), so the selected pill sits inside the
 * track without overflowing it.
 *
 * Keys are the TRACK's rung name, the same names Button and Input use for the same pixels
 * (`sm` 24, `lg` 32). The larger track used to be called `md`, which is 28px everywhere else.
 */
const TRACK_HEIGHT = {
  sm: 'h-[var(--chrome-control-sm)]',
  lg: 'h-[var(--chrome-control-lg)]',
} as const

const ITEM_HEIGHT = {
  sm: 'h-[var(--chrome-control-xs)]',
  lg: 'h-[var(--chrome-control-md)]',
} as const

const ITEM_ACTIVE: Record<SegmentedVariant, string> = {
  // `--surface-active`, not `bg-surface-raised`: raised mixes from a DARKER ground than the
  // toolbar, so the selected segment read as a black pill inside a lighter track — inverted
  // relief. The 11% veil lifts the pill off the track the way it does on the opaque themes.
  raised: 'bg-surface-active text-foreground shadow-sm',
  // A VEIL, not `bg-background`: the host's glass theme clears a `bg-background` nested inside
  // another one (its paint-the-ground-once rule), which left the selected segment with no fill
  // at all. `--surface-active` is the standard "this one is chosen" step and survives that rule.
  muted: 'bg-surface-active text-foreground shadow-sm',
  ghost: 'bg-surface-hover font-medium text-foreground',
  outlined: 'bg-surface-active font-medium text-foreground shadow-sm',
}

const ITEM_INACTIVE: Record<SegmentedVariant, string> = {
  raised: 'text-text-faint hover:text-foreground',
  muted: 'text-text-soft hover:text-foreground',
  ghost: 'text-text-faint hover:text-text-soft',
  outlined: 'text-text-faint hover:text-text-soft',
}

export type SegmentedRadioSize = 'sm' | 'lg'

export interface SegmentedRadioOption<T extends string> {
  value: T
  label: React.ReactNode
  title?: string
  disabled?: boolean
  /** Required when `label` has no accessible text. */
  'aria-label'?: string
  className?: string
}

type SegmentedRadioAccessibleName =
  | { 'aria-label': string; 'aria-labelledby'?: string }
  | { 'aria-label'?: string; 'aria-labelledby': string }

export type SegmentedRadioGroupProps<T extends string> = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onChange' | 'aria-label' | 'aria-labelledby'
> &
  SegmentedRadioAccessibleName & {
    value: T
    onValueChange: (value: T) => void
    options: readonly SegmentedRadioOption<T>[]
    /** Shared native radio name. Generated automatically outside form contracts. */
    name?: string
    size?: SegmentedRadioSize
    variant?: SegmentedVariant
    fullWidth?: boolean
    disabled?: boolean
    required?: boolean
    form?: string
  }

/**
 * Mutually-exclusive segmented choice backed by one native radio group. Native
 * inputs provide a single Tab stop, arrow-key selection, labels, and form data;
 * the visible segments own only layout and theme styling.
 */
export function SegmentedRadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  name,
  size = 'lg',
  variant = 'raised',
  fullWidth = false,
  disabled = false,
  required,
  form,
  className,
  ...props
}: SegmentedRadioGroupProps<T>) {
  const generatedName = useId()
  const radioName = name ?? `localix-segmented-${generatedName}`

  return (
    <div
      {...props}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      aria-required={required || undefined}
      data-slot="segmented-radio-group"
      data-size={size}
      data-variant={variant}
      className={cn(
        'flex w-fit items-center gap-0.5 p-0.5',
        size === 'sm' ? `${TRACK_HEIGHT.sm} rounded-md` : `${TRACK_HEIGHT.lg} rounded-lg`,
        fullWidth && 'w-full',
        TRACK[variant],
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        const optionDisabled = disabled || option.disabled
        return (
          <label
            key={option.value}
            title={option.title}
            className={cn(
              'relative flex min-w-0 cursor-pointer select-none',
              fullWidth && 'flex-1',
              optionDisabled && 'cursor-not-allowed',
            )}
          >
            <input
              type="radio"
              name={radioName}
              value={option.value}
              checked={active}
              disabled={optionDisabled}
              required={required}
              form={form}
              aria-label={option['aria-label']}
              onChange={() => onValueChange(option.value)}
              className="peer sr-only forced-colors:not-sr-only forced-colors:shrink-0"
            />
            <span
              data-state={active ? 'checked' : 'unchecked'}
              className={cn(
                // Same inset hairline as `CONTROL_FOCUS_VISIBLE`, spelled with the `peer-` variant
                // because the focus lives on the visually-hidden radio, not on this label.
                'flex min-w-0 items-center justify-center gap-1 outline-none transition-colors peer-focus-visible:ring-1 peer-focus-visible:ring-inset peer-focus-visible:ring-control-border-focus peer-disabled:opacity-50 motion-reduce:transition-none forced-colors:bg-transparent forced-colors:shadow-none',
                size === 'sm'
                  ? `${ITEM_HEIGHT.sm} rounded px-1.5 text-2xs`
                  : `${ITEM_HEIGHT.lg} rounded-md px-2.5 text-xs`,
                fullWidth && 'w-full',
                active ? ITEM_ACTIVE[variant] : ITEM_INACTIVE[variant],
                option.className,
              )}
            >
              {option.label}
            </span>
          </label>
        )
      })}
    </div>
  )
}

/**
 * Segmented action control. Each item is an `aria-pressed` button, so use this
 * for view/mode commands whose current state is also actionable. Use
 * `SegmentedRadioGroup` for a mutually-exclusive value or form choice.
 */
export function SegmentedControl({
  variant = 'raised',
  fullWidth = false,
  className,
  children,
  ...rest
}: {
  variant?: SegmentedVariant
  /** Stretch to fill the row; items share the width equally. */
  fullWidth?: boolean
  className?: string
  children: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  // Stable identity so SegmentedControlItem consumers don't re-render when the
  // track re-renders for unrelated reasons (variant/fullWidth rarely change).
  const ctxValue = useMemo(() => ({ variant, fullWidth }), [variant, fullWidth])
  return (
    <SegCtx.Provider value={ctxValue}>
      <div
        role="group"
        className={cn(
          `flex ${TRACK_HEIGHT.lg} items-center gap-0.5 rounded-lg p-0.5`,
          fullWidth ? 'w-full' : 'w-fit',
          TRACK[variant],
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    </SegCtx.Provider>
  )
}

export function SegmentedControlItem({
  active,
  onClick,
  disabled = false,
  className,
  title,
  'aria-label': ariaLabel,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  className?: string
  title?: string
  /** Accessible name; defaults to `title` for icon-only items (non-string children). */
  'aria-label'?: string
  children: React.ReactNode
}) {
  const { variant, fullWidth } = useContext(SegCtx)
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? (typeof children === 'string' ? undefined : title)}
      className={cn(
        `flex ${ITEM_HEIGHT.lg} min-w-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs outline-none focus-ring transition-colors disabled:cursor-not-allowed disabled:opacity-50`,
        fullWidth && 'flex-1',
        active ? ITEM_ACTIVE[variant] : ITEM_INACTIVE[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Compact typed choice control used by plugin and host panels alike. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ...accessibleName
}: SegmentedRadioAccessibleName & {
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (value: T) => void
  /** Layout classes for the track, such as intrinsic sizing inside a wrapping toolbar. */
  className?: string
}) {
  return (
    <SegmentedRadioGroup
      {...accessibleName}
      variant="muted"
      value={value}
      onValueChange={onChange}
      options={options.map((option) => ({
        value: option.id,
        label: option.label,
        // Inline padding stays on the shared item ladder (px-2.5); only the
        // press affordance is added on top.
        className: 'font-medium active:scale-[0.97]',
      }))}
    />
  )
}
