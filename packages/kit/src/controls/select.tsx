import { forwardRef, useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../overlays/dropdown-menu'
import { MenuRowLabel, MenuTrailingCheck } from '../overlays/menu-row-parts'
import {
  choiceTriggerIconVariants,
  choiceTriggerVariants,
  type ChoiceControlSize,
} from './choice-trigger'
import { useFieldControlProps } from './field'

export interface SelectOption {
  value: string
  label: string
  icon?: LucideIcon
  /** What choosing the option means, as a line under its label — the menu rows' `description`. */
  description?: string
  disabled?: boolean
}

export interface SelectProps extends Pick<
  ComponentPropsWithoutRef<'button'>,
  'id' | 'disabled' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid'
> {
  value: string
  onValueChange: (value: string) => void
  options: readonly SelectOption[]
  /** Shown when no option matches `value` (e.g. an empty value). */
  placeholder?: string
  /** Control scale aligned with Input: inline (`sm`), ordinary (`md`), or settings (`lg`). */
  size?: ChoiceControlSize
  /** Popup alignment relative to the trigger. */
  align?: 'start' | 'center' | 'end'
  /** Extra classes on the trigger. */
  className?: string
  /** Menu width; defaults to "at least the trigger, as wide as the options need". */
  contentClassName?: string
}

/**
 * Styled single-select with native-equivalent listbox semantics, typeahead and
 * keyboard navigation. Short, closed choice sets belong here; searchable or
 * editable sets belong in Combobox/Input+datalist respectively.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    onValueChange,
    options,
    placeholder = 'Select…',
    size = 'lg',
    align = 'start',
    disabled,
    className,
    contentClassName,
    ...triggerProps
  },
  ref,
) {
  const controlProps = useFieldControlProps({ ...triggerProps, disabled })
  const selected = options.find((option) => option.value === value)
  const SelectedIcon = selected?.icon
  const [open, setOpen] = useState(false)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!open) return
    typeaheadRef.current = ''
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
    typeaheadTimerRef.current = null
  }, [open])

  const handleClosedTypeahead = (key: string) => {
    const enabled = options.filter((option) => !option.disabled)
    if (enabled.length === 0) return
    const search = `${typeaheadRef.current}${key}`.toLowerCase()
    const normalizedSearch =
      search.length > 1 && Array.from(search).every((character) => character === search[0])
        ? search[0]!
        : search
    const selectedIndex = enabled.findIndex((option) => option.value === value)
    const ordered = enabled.map(
      (_, index) => enabled[(Math.max(selectedIndex, 0) + index) % enabled.length]!,
    )
    const candidates =
      normalizedSearch.length === 1 ? ordered.filter((option) => option.value !== value) : ordered
    const match = candidates.find((option) =>
      option.label.toLowerCase().startsWith(normalizedSearch),
    )
    if (match) onValueChange(match.value)

    typeaheadRef.current = search
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
    typeaheadTimerRef.current = setTimeout(() => {
      typeaheadRef.current = ''
      typeaheadTimerRef.current = null
    }, 1_000)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={controlProps.disabled}>
        <button
          ref={ref}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-autocomplete="none"
          {...controlProps}
          data-slot="select-trigger"
          className={cn(choiceTriggerVariants({ size, placeholder: !selected }), className)}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return
            if (event.key === 'ArrowUp') {
              setOpen(true)
              event.preventDefault()
              return
            }
            if (!open && event.key !== ' ' && event.key.length === 1) {
              handleClosedTypeahead(event.key)
              event.preventDefault()
            }
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
            {SelectedIcon && (
              <SelectedIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-text-soft"
                strokeWidth={1.75}
              />
            )}
            <span className="truncate">{selected?.label ?? placeholder}</span>
          </span>
          <ChevronDown aria-hidden="true" className={choiceTriggerIconVariants({ size })} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        role="listbox"
        align={align}
        aria-orientation="vertical"
        // AT LEAST the trigger's width, then as wide as the longest option needs, capped so a
        // stray long label cannot span the window. It used to be EXACTLY the trigger's width,
        // which meant the menu was sized by whichever option happened to be selected: pick a
        // short one and every longer label in the list truncated to an ellipsis.
        className={cn(
          'w-auto min-w-[max(8rem,var(--radix-dropdown-menu-trigger-width))] max-w-[min(22rem,var(--radix-dropdown-menu-content-available-width))]',
          contentClassName,
        )}
      >
        {options.map((option) => {
          const OptionIcon = option.icon
          const isSelected = option.value === value
          // The row is a `selected` menu row's recipe (`menu-row-parts.tsx`) under listbox
          // semantics: a form field announces options, a chrome menu announces radio items, and
          // the two must still look like one list of choices.
          return (
            <DropdownMenuItem
              key={option.value}
              role="option"
              aria-selected={isSelected}
              textValue={option.label}
              disabled={option.disabled}
              data-slot="select-item"
              onSelect={() => onValueChange(option.value)}
            >
              {OptionIcon && (
                <OptionIcon aria-hidden="true" className="text-text-soft" strokeWidth={1.75} />
              )}
              <MenuRowLabel label={option.label} description={option.description} />
              <MenuTrailingCheck selected={isSelected} />
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
