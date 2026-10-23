import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  choiceTriggerIconVariants,
  choiceTriggerVariants,
  type ChoiceControlSize,
} from './choice-trigger'
import { useFieldControlProps } from './field'
import { Popover, PopoverContent, PopoverTrigger } from '../overlays/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../overlays/command'

/** One selectable entry in a {@link Combobox}. */
export interface ComboboxOption {
  value: string
  label: string
  /** Optional trailing hint (e.g. "current") shown muted beside the label. */
  hint?: string
  /** Optional secondary line shown below the label. */
  description?: string
  /** Optional stable section heading; option order and first group occurrence are preserved. */
  group?: string
  /** Optional leading glyph. */
  icon?: React.ReactNode
}

export interface ComboboxProps extends Pick<
  React.ComponentPropsWithoutRef<'button'>,
  'id' | 'disabled' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid'
> {
  value: string
  onValueChange: (value: string) => void
  options: readonly ComboboxOption[]
  /** Trigger text when no option matches `value`. */
  placeholder?: string
  /** Search field placeholder. */
  searchPlaceholder?: string
  /** Message when the filter matches nothing. */
  emptyLabel?: React.ReactNode
  /** Optional node pinned above the option list (e.g. a "12 namespaces" count). */
  menuHeader?: React.ReactNode
  /** Control scale aligned with Select and Input. */
  size?: ChoiceControlSize
  /** Preserve wheel/focus interaction when opened from inside a modal dialog. */
  modal?: boolean
  /** Extra classes on the trigger. */
  className?: string
  /** Menu width; defaults to matching the trigger width. */
  contentClassName?: string
}

/**
 * A searchable single-select composite — a type-to-filter, keyboard-first
 * replacement for {@link Select} when the option list is long enough that an
 * in-list search matters. Its compact button discloses a search dialog; the
 * `CommandInput` inside that dialog is the sole editable combobox and owns
 * focus/list navigation. The public `value`/`onValueChange`/`options` contract
 * remains a drop-in match for `Select` where search is wanted.
 */
export const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(function Combobox(
  {
    value,
    onValueChange,
    options,
    placeholder = 'Select…',
    searchPlaceholder = 'Search…',
    emptyLabel = 'No matches',
    menuHeader,
    size = 'lg',
    modal = false,
    disabled,
    className,
    contentClassName,
    ...triggerProps
  },
  ref,
) {
  const controlProps = useFieldControlProps({ ...triggerProps, disabled })
  const [open, setOpen] = React.useState(false)
  const selected = options.find((option) => option.value === value)
  const groups = React.useMemo(() => {
    const byHeading = new Map<string | undefined, ComboboxOption[]>()
    for (const option of options) {
      const group = byHeading.get(option.group)
      if (group) group.push(option)
      else byHeading.set(option.group, [option])
    }
    return [...byHeading.entries()]
  }, [options])

  const pick = (next: string) => {
    onValueChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild disabled={controlProps.disabled}>
        <button
          ref={ref}
          type="button"
          // This button only discloses a search dialog. The actual editable
          // combobox is CommandInput inside the popover; declaring both would
          // expose two competing comboboxes to assistive technology.
          aria-haspopup="dialog"
          aria-expanded={open}
          {...controlProps}
          className={cn(choiceTriggerVariants({ size, placeholder: !selected }), className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.icon ? (
              <span aria-hidden="true" className="flex shrink-0 items-center text-text-soft">
                {selected.icon}
              </span>
            ) : null}
            <span className="truncate">{selected?.label ?? placeholder}</span>
          </span>
          <ChevronDown aria-hidden="true" className={choiceTriggerIconVariants({ size })} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          'w-(--radix-popover-trigger-width) min-w-[10rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0',
          contentClassName,
        )}
      >
        <Command label={controlProps['aria-label'] ?? searchPlaceholder}>
          <CommandInput placeholder={searchPlaceholder} />
          {menuHeader ? (
            <div className="border-b border-border-soft px-2.5 py-1 text-2xs text-text-faint select-none">
              {menuHeader}
            </div>
          ) : null}
          <CommandList className="max-h-64">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            {groups.map(([heading, groupOptions], groupIndex) => (
              <CommandGroup key={heading ?? `ungrouped-${groupIndex}`} heading={heading}>
                {groupOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.description ?? ''} ${option.value}`}
                    onSelect={() => pick(option.value)}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    {option.icon ? (
                      <span aria-hidden="true" className="flex shrink-0 items-center opacity-70">
                        {option.icon}
                      </span>
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.description ? (
                        <span className="truncate font-mono text-2xs text-text-faint">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {option.hint ? (
                      <span className="shrink-0 text-2xs text-text-faint">{option.hint}</span>
                    ) : null}
                    <Check
                      aria-hidden="true"
                      className={cn(
                        'size-3.5 shrink-0 text-text-faint',
                        value === option.value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
})
