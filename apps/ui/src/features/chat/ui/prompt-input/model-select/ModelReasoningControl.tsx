import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { DEFAULT_REASONING_EFFORT, type REASONING_EFFORT_OPTIONS } from '@localixai/agent'
import type { ReasoningEffort } from '../../../model/reasoning'
import { clampModelReasoning, modelReasoningOptions } from '../../../model/modelReasoning'
import { reasoningEntries } from './reasoningEntries'

interface ModelReasoningControlProps {
  modelLabel: string
  supportsReasoning: boolean
  /**
   * The levels this model offers (`CatalogModel.reasoningEfforts`). Absent means the catalog
   * did not publish them, and the whole scale is offered — the runtime clamps either way, but
   * a level the model cannot serve should not be on screen when we know better.
   */
  reasoningEfforts?: readonly string[]
  value: ReasoningEffort | undefined
  inheritedEffort?: ReasoningEffort
  selected: boolean
  display?: 'popover' | 'inline'
  disabled?: boolean
  className?: string
  onChange: (effort: ReasoningEffort | undefined) => void
  /** The level list opened or closed — a host holds its hover state while it is open. */
  onOpenChange?: (open: boolean) => void
}

interface ReasoningSliderProps {
  index: number
  /** The levels this model offers — the scale is per model, so the slider is told its stops. */
  options: typeof REASONING_EFFORT_OPTIONS
  modelLabel: string
  optionLabel: string | undefined
  disabled: boolean | undefined
  compact?: boolean
  onPreview: (index: number) => void
  onCommit: (index: number) => void
}

/** One discrete slider primitive shared by the inline rows and the expanded popover. */
function ReasoningSlider({
  index,
  options,
  modelLabel,
  optionLabel,
  disabled,
  compact = false,
  onPreview,
  onCommit,
}: ReasoningSliderProps) {
  return (
    <SliderPrimitive.Root
      value={[index]}
      min={0}
      max={Math.max(0, options.length - 1)}
      step={1}
      disabled={disabled}
      className={cn(
        'relative flex w-full touch-none select-none items-center data-disabled:opacity-50',
        compact ? 'h-4' : 'h-5',
      )}
      onValueChange={([nextIndex]) => {
        if (nextIndex !== undefined) onPreview(nextIndex)
      }}
      onValueCommit={([nextIndex]) => {
        if (nextIndex !== undefined) onCommit(nextIndex)
      }}
    >
      <SliderPrimitive.Track
        className={cn(
          'relative w-full grow overflow-hidden rounded-full bg-control-border/70',
          compact ? 'h-1' : 'h-1.5',
        )}
      >
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-foreground/75" />
      </SliderPrimitive.Track>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 flex items-center justify-between px-px"
      >
        {options.map((entry, optionIndex) => (
          <span
            key={entry.value}
            className={cn(
              'rounded-full',
              compact ? 'size-0.5' : 'size-1 ring-1 ring-surface-raised',
              optionIndex <= index ? 'bg-foreground' : 'bg-text-faint',
            )}
          />
        ))}
      </div>
      <SliderPrimitive.Thumb
        aria-label={`Reasoning effort for ${modelLabel}`}
        aria-valuetext={optionLabel}
        title={`Reasoning effort: ${optionLabel}`}
        className={cn(
          // The resting `ring-1` is this thumb's edge, not a focus cue — focus is the shared
          // `focus-ring` outline, which draws independently of the box-shadow ring underneath.
          'block cursor-grab rounded-full border-surface-raised bg-foreground shadow-(--shadow-raised) ring-1 ring-foreground/35 outline-none transition-[box-shadow,transform] hover:scale-110 focus-ring active:cursor-grabbing active:scale-105',
          compact ? 'size-3 border-2' : 'size-4 border-[3px]',
        )}
      />
    </SliderPrimitive.Root>
  )
}

export function ModelReasoningControl({
  modelLabel,
  supportsReasoning,
  reasoningEfforts,
  value,
  inheritedEffort,
  selected,
  display = 'popover',
  disabled,
  className,
  onChange,
  onOpenChange,
}: ModelReasoningControlProps) {
  // Both the offered levels and the one shown come from the model: a preference stored against
  // a finer-grained model lands on the nearest level THIS one has, which is also what the
  // request will carry.
  const REASONING_OPTIONS = modelReasoningOptions(reasoningEfforts)
  const resolvedEffort = clampModelReasoning(
    value ?? inheritedEffort ?? DEFAULT_REASONING_EFFORT,
    reasoningEfforts,
  )
  const resolvedIndex = Math.max(
    0,
    REASONING_OPTIONS.findIndex((entry) => entry.value === resolvedEffort),
  )
  const [draftIndex, setDraftIndex] = useState(resolvedIndex)

  useEffect(() => setDraftIndex(resolvedIndex), [resolvedIndex])

  if (!supportsReasoning) {
    return (
      <span
        title={`${modelLabel} does not expose reasoning controls`}
        className={cn(
          'inline-flex h-(--chrome-control-md) shrink-0 items-center justify-center rounded-md px-2 text-2xs text-text-faint',
          className,
        )}
      >
        —
      </span>
    )
  }

  const option = REASONING_OPTIONS[resolvedIndex]
  const draftOption = REASONING_OPTIONS[draftIndex] ?? option
  const inherits = value === undefined && inheritedEffort !== undefined
  const label = inherits ? `Session · ${option?.label ?? resolvedEffort}` : option?.label
  const inheritIndex =
    inheritedEffort === undefined
      ? resolvedIndex
      : Math.max(
          0,
          REASONING_OPTIONS.findIndex((entry) => entry.value === inheritedEffort),
        )

  const selectEffort = (index: number) => {
    const nextOption = REASONING_OPTIONS[index]
    if (!nextOption) return
    setDraftIndex(index)
    onChange(nextOption.value)
  }

  if (display === 'inline') {
    return (
      <div
        data-slot="model-reasoning-inline"
        title={
          inherits
            ? `Uses session reasoning: ${draftOption?.label}`
            : `Reasoning: ${draftOption?.label}`
        }
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          'inline-flex h-[var(--chrome-control-md)] w-[7.75rem] shrink-0 items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-surface-hover',
          selected ? 'text-foreground' : 'text-text-soft',
          className,
        )}
      >
        {inheritedEffort !== undefined ? (
          <button
            type="button"
            aria-label={
              inherits
                ? `Uses session reasoning: ${draftOption?.label}`
                : `Use session reasoning: ${REASONING_OPTIONS[inheritIndex]?.label}`
            }
            title={inherits ? 'Uses session reasoning' : 'Use session reasoning'}
            onClick={() => {
              if (inherits) return
              setDraftIndex(inheritIndex)
              onChange(undefined)
            }}
            className={cn(
              'w-14 shrink-0 rounded-sm text-right text-2xs font-medium outline-none transition-colors focus-ring',
              inherits ? 'text-text-faint' : 'text-text-soft hover:text-foreground',
            )}
          >
            {inherits ? 'Session' : draftOption?.label}
          </button>
        ) : (
          <span className="w-14 shrink-0 text-right text-2xs font-medium">
            {draftOption?.label}
          </span>
        )}
        <ReasoningSlider
          index={draftIndex}
          options={REASONING_OPTIONS}
          modelLabel={modelLabel}
          optionLabel={draftOption?.label}
          disabled={disabled}
          compact
          onPreview={setDraftIndex}
          onCommit={selectEffort}
        />
      </div>
    )
  }

  // The same rows the details panel's menu draws (`reasoningEntries`): a hand-built radio list
  // here had already drifted from it — its "follow" choice was a footer button that renamed
  // itself once pressed, where the panel had it as the first row of the list.
  const entries = reasoningEntries({ reasoningEfforts, value, inheritedEffort, onChange })

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Reasoning for ${modelLabel}: ${label}`}
          // What the control IS, not only what it is set to. "Reasoning: high" told somebody
          // who already knew; the strip's three controls are a model name, a word and a
          // number, and none of them names its own subject on the face of it. One line: a
          // hint over a dense strip has room for a label, not for a paragraph.
          title={
            inherits ? 'Reasoning effort: follows the conversation' : `Reasoning effort: ${label}`
          }
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
          }}
          // A quiet text trigger: no outline, no resting fill. It sits on a selected row or in
          // the composer strip, both of which already frame it, and a bordered box there was a
          // second frame that read as noise. Hover and the open state take the shared veils.
          className={cn(
            'inline-flex h-(--chrome-control-md) shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-2xs font-medium outline-none transition-colors focus-ring hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-active aria-expanded:text-foreground disabled:cursor-not-allowed disabled:opacity-45',
            selected ? 'text-foreground' : 'text-text-soft',
            className,
          )}
        >
          <span className="min-w-0 truncate text-left">{label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      {/* Above the trigger, like every other composer chip: the composer sits at the bottom of
          the window, so a menu opening downward lands over the message you are writing. The
          header names the model, because the level is that model's and the chip beside it may
          be truncated. */}
      <DropdownMenuContent align="end" side="top" className="w-64">
        <MenuEntries entries={[{ header: modelLabel }, ...entries]} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
