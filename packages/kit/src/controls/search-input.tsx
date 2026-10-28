import { Search, X } from 'lucide-react'
import { useEffectEvent, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { cn, CONTROL_FOCUS_WITHIN, FIELD_SURFACE } from '@localixai/mini-app-sdk/ui/classes'

type SearchInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'size' | 'className' | 'ref'
> & {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  /** Accessible label (defaults to the placeholder). */
  'aria-label'?: string
  autoFocus?: boolean
  /**
   * `bare` drops the box chrome (border/bg/height) — for use inside a popover or
   * panel header that already provides the frame. Default renders the standalone
   * bordered search box.
   */
  bare?: boolean
  /**
   * Box density, on the chrome ladder's names like Button: `lg` (32px, default), `md` (28px,
   * nested), or `xl` (36px, primary search surfaces).
   */
  size?: 'md' | 'lg' | 'xl'
  /** Slightly quieter fill, for a field nested inside an already-inset panel. */
  inset?: boolean
  /** Palette: `default` or `sidebar` (sidebar-foreground tints for the sidebar shell). */
  tone?: 'default' | 'sidebar'
  /** Extra classes on the outer wrapper. */
  className?: string
  /** A quiet control at the field's end, after the clear button (a scope picker). */
  trailing?: ReactNode
}

/**
 * The project's search field — a Search icon, an input, and a clear (×) button
 * that appears once there's text. One primitive so every search box (a board filter,
 * session picker, dependency picker, …) shares the same chrome and behavior
 * instead of re-implementing the icon+input+clear cluster each time.
 */
export function SearchInput({
  value,
  onValueChange,
  placeholder = 'Search…',
  bare = false,
  size = 'lg',
  inset = false,
  tone = 'default',
  autoFocus,
  className,
  onKeyDown,
  onFocus,
  onBlur,
  'aria-label': ariaLabel,
  trailing,
  ...inputProps
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // The `autoFocus` attribute, done by hand: focus once when the field mounts, before paint.
  const focusOnMount = useEffectEvent(() => {
    if (autoFocus) inputRef.current?.focus()
  })
  useLayoutEffect(() => {
    focusOnMount()
  }, [])
  // The two ends of the three rungs this field uses; `lg` is the middle.
  const compact = size === 'md'
  const roomy = size === 'xl'
  const sidebar = tone === 'sidebar'
  const iconColor = sidebar ? 'text-sidebar-foreground/45' : 'text-text-faint'
  const inputColor = sidebar
    ? 'text-sidebar-foreground placeholder:text-sidebar-foreground/40'
    : 'text-foreground placeholder:text-text-faint'
  const clearColor = sidebar
    ? 'text-sidebar-foreground/40 hover:text-sidebar-foreground'
    : 'text-text-faint hover:text-foreground'
  return (
    <div
      data-size={bare ? undefined : size}
      className={cn(
        'flex min-w-0 items-center',
        roomy ? 'gap-2' : 'gap-1.5',
        bare
          ? compact
            ? 'h-4'
            : roomy
              ? 'h-[var(--chrome-control-sm)]'
              : 'h-[var(--chrome-control-xs)]'
          : cn(
              // The field recipe every Input and Select trigger wears — radius, hairline and fill —
              // so a search beside a picker reads as one strip. The sidebar's own search keeps its
              // fainter hairline: it sits on the sidebar ground, not a pane.
              sidebar ? 'rounded-md border border-control-border/55 bg-field-fill' : FIELD_SURFACE,
              'transition-colors hover:border-control-border-hover',
              CONTROL_FOCUS_WITHIN,
              // `inset` steps one notch quieter for a field nested in an already-inset panel.
              inset && 'bg-field-fill/70',
              // One ladder with Input and the Select/Combobox trigger, name for name:
              // md 28 / lg 32 / xl 36, one radius (`rounded-md`: 24-36px) on every rung.
              compact
                ? 'h-[var(--chrome-control-md)] px-2'
                : roomy
                  ? 'h-[var(--chrome-control-xl)] px-3'
                  : 'h-[var(--chrome-control-lg)] px-2.5',
            ),
        className,
      )}
    >
      <Search
        className={cn('shrink-0', iconColor, compact ? 'size-3' : roomy ? 'size-4' : 'size-3.5')}
      />
      <input
        {...inputProps}
        ref={inputRef}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        className={cn(
          'h-full min-w-0 flex-1 border-none bg-transparent outline-none',
          inputColor,
          compact ? 'text-2xs' : roomy ? 'text-sm' : 'text-xs',
        )}
      />
      {value && (
        <button
          type="button"
          onMouseDown={(event) => {
            // Clearing is an edit to the active query, not a focus transition.
            // Prevent the button from stealing focus from the search field.
            event.preventDefault()
          }}
          onClick={() => {
            onValueChange('')
            inputRef.current?.focus()
          }}
          className={cn(
            '-m-1 shrink-0 rounded-sm p-1 outline-none transition-colors focus-ring',
            clearColor,
          )}
          aria-label="Clear search"
        >
          <X className={roomy ? 'size-3.5' : 'size-3'} />
        </button>
      )}
      {trailing}
    </div>
  )
}
