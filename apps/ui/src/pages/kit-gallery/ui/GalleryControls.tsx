import { useState, type ReactNode } from 'react'
import { Folder, Link2, Plus, Settings2, ShieldCheck } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Checkbox } from '@localixai/kit/checkbox'
import { Chip, ChipButton } from '@localixai/kit/chip'
import { ComposerChip, ComposerChipChevron } from '@localixai/kit/composer-chip'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { SearchInput } from '@localixai/kit/search-input'
import { Select } from '@localixai/kit/select'
import { SELECTED_ROW } from '@localixai/kit/selected-row'
import { Slider } from '@localixai/kit/slider'
import { Switch } from '@localixai/kit/switch'
import { TogglePill } from '@localixai/kit/toggle-pill'
import { Segmented } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * The states a static page cannot reach by itself. The capture harness forces the pseudo-class
 * named by `data-gallery-state` on each marked element (DevTools' forced element state), so the
 * primitive paints its own hover, press and focus — never a fill transcribed for the gallery.
 */
export const STATES = ['rest', 'hover', 'active', 'focus-visible', 'disabled'] as const
type State = (typeof STATES)[number]

const stateProps = (state: State) =>
  state === 'disabled'
    ? { disabled: true }
    : state === 'rest'
      ? {}
      : { 'data-gallery-state': state }

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="w-28 shrink-0 text-2xs text-text-faint">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function ComposerChips() {
  return (
    <>
      {STATES.map((state) => (
        <ComposerChip key={state} {...stateProps(state)}>
          <Folder className="size-3.5" />
          <span>{state}</span>
        </ComposerChip>
      ))}
      <ComposerChip>
        <ShieldCheck className="size-3.5" />
        <span>Default</span>
        <ComposerChipChevron />
      </ComposerChip>
      <ComposerChip aria-expanded>
        <Link2 className="size-3.5" />
        <span className="font-medium">Context</span>
        <Chip tone="active" size="counter">
          1
        </Chip>
        <ComposerChipChevron />
      </ComposerChip>
    </>
  )
}

const BUTTON_VARIANTS = ['default', 'secondary', 'field', 'mono', 'destructive'] as const

/** Every control family, each in every state, as it sits on whatever ground holds it. */
export function ControlSet() {
  const [text, setText] = useState('')
  const [choice, setChoice] = useState('one')
  const [mode, setMode] = useState<'list' | 'grid' | 'board'>('list')
  const [level, setLevel] = useState(1)
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Row label="Composer chips">
        <ComposerChips />
      </Row>
      {BUTTON_VARIANTS.map((variant) => (
        <Row key={variant} label={`Button ${variant}`}>
          {STATES.map((state) => (
            <Button key={state} variant={variant} size="sm" {...stateProps(state)}>
              {state}
            </Button>
          ))}
        </Row>
      ))}
      <Row label="Icon buttons">
        {STATES.map((state) => (
          <IconButton key={state} aria-label={`Add ${state}`} {...stateProps(state)}>
            <Plus />
          </IconButton>
        ))}
        <IconButton aria-label="Settings" aria-pressed>
          <Settings2 />
        </IconButton>
      </Row>
      <Row label="Chips, badges">
        <Chip>neutral</Chip>
        <Chip tone="active">active</Chip>
        <Chip tone="accent">accent</Chip>
        <Chip tone="success">success</Chip>
        <Chip tone="error">error</Chip>
        <Chip size="counter">3</Chip>
        <Chip tone="active" size="counter">
          12
        </Chip>
        <ChipButton>tag</ChipButton>
        <ChipButton data-gallery-state="hover">tag hover</ChipButton>
        <TogglePill active={false} onClick={() => {}}>
          Filter
        </TogglePill>
        <TogglePill active onClick={() => {}}>
          Filter on
        </TogglePill>
      </Row>
      <Row label="Fields">
        <SearchInput value={text} onValueChange={setText} placeholder="Search…" size="md" />
        <Input className="w-40" placeholder="Input" />
        <Input className="w-40" defaultValue="Focused" data-gallery-state="focus-visible" />
        <Input className="w-32" placeholder="Disabled" disabled />
        <Input className="w-32" defaultValue="Invalid" aria-invalid />
        <div className="w-36">
          <Select
            aria-label="Choice"
            size="md"
            value={choice}
            onValueChange={setChoice}
            options={[
              { value: 'one', label: 'Medium' },
              { value: 'two', label: 'High' },
            ]}
          />
        </div>
      </Row>
      <Row label="Choices">
        <Segmented
          aria-label="View"
          value={mode}
          onChange={setMode}
          options={[
            { id: 'list', label: 'List' },
            { id: 'grid', label: 'Grid' },
            { id: 'board', label: 'Board' },
          ]}
        />
        <Switch aria-label="On" checked onChange={() => {}} />
        <Switch aria-label="Off" checked={false} onChange={() => {}} />
        <Checkbox aria-label="Checked" checked onChange={() => {}} />
        <Checkbox aria-label="Unchecked" checked={false} onChange={() => {}} />
        <div className="w-48">
          <Slider
            aria-label="Level"
            steps={['Low', 'Mid', 'High']}
            value={level}
            onValueChange={setLevel}
          />
        </div>
      </Row>
      <Row label="List rows">
        <div className="flex w-72 flex-col gap-0.5">
          {(['rest', 'hover', 'selected', 'focus-visible'] as const).map((state) => (
            <button
              key={state}
              type="button"
              data-gallery-state={
                state === 'hover' || state === 'focus-visible' ? state : undefined
              }
              className={cn(
                'flex h-(--chrome-control-lg) items-center rounded-md px-2 text-left text-xs text-text-soft outline-none transition-colors focus-ring hover:bg-surface-hover hover:text-foreground',
                state === 'selected' && SELECTED_ROW,
              )}
            >
              Row — {state}
            </button>
          ))}
        </div>
      </Row>
    </div>
  )
}
