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
}

/** Generic option picker for any enumerated slash-command argument. */
export function SlashArgMenu({
  options,
  activeIndex,
  onSelect,
  onHover,
  menuId = COMPOSER_COMPLETION_MENU_ID,
}: SlashArgMenuProps) {
  if (options.length === 0) return null

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
    />
  )
}
