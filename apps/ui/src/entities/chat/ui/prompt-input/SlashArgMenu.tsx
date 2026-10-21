import type { SlashArgOption } from './SlashArgSpec'
import {
  COMPOSER_COMPLETION_MENU_ID,
  CompletionMenu,
  type CompletionMenuItem,
} from './CompletionMenu'

interface SlashArgMenuProps {
  options: SlashArgOption[]
  activeIndex: number
  onSelect: (opt: SlashArgOption) => void
  onHover: (index: number) => void
  menuId?: string
  /** Guidance for a free-text flag value, shown in place of options. */
  hint?: { flag: string; description: string; empty: boolean } | null
}

/** Generic option picker for any enumerated slash-command argument. */
export function SlashArgMenu({
  options,
  activeIndex,
  onSelect,
  onHover,
  menuId = COMPOSER_COMPLETION_MENU_ID,
  hint,
}: SlashArgMenuProps) {
  if (options.length === 0 && !hint) return null

  const items: CompletionMenuItem[] = options.map((opt, index) => ({
    key: opt.value,
    index,
    onSelect: () => onSelect(opt),
    content: (
      <>
        <span className="shrink-0 text-sm font-medium text-foreground">{opt.label}</span>
        {opt.description && (
          <span className="min-w-0 flex-1 truncate text-sm text-text-soft">{opt.description}</span>
        )}
      </>
    ),
  }))

  return (
    <CompletionMenu
      id={menuId}
      items={items}
      activeIndex={activeIndex}
      onHover={onHover}
      label="Command arguments"
      singular="option"
      plural="options"
      empty={
        hint && (
          <div className="flex flex-col gap-0.5 px-3 py-2 text-sm">
            <span>
              <span className="font-medium text-foreground">{hint.flag}</span>
              {hint.description && <span className="text-text-soft"> · {hint.description}</span>}
            </span>
            <span className="text-text-soft">
              {hint.empty
                ? 'Type the value, or press Backspace to remove this option.'
                : 'Type -- for another option, or press Enter to run.'}
            </span>
          </div>
        )
      }
    />
  )
}
