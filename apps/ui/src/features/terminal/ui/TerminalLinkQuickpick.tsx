import { FileText, Link as LinkIcon } from 'lucide-react'
import { filterTerminalLinks, type TerminalLinkItem } from '../model/terminalLinks'
import { TerminalQuickpick } from './TerminalQuickpick'

/**
 * Keyboard-first "open detected link" picker for a terminal pane (⌘/Ctrl+⇧+O),
 * the terminal analogue of the editor's go-to-symbol palette. It lists every
 * distinct file:line / URL link in the terminal buffer (gathered by
 * `collectTerminalLinks`), filterable by typing, navigable with ↑/↓, opened with
 * Enter, dismissed with Esc — so links are reachable with no mouse.
 *
 * Purely presentational: the parent gathers the links and owns what "open" does
 * (reveal a file in the grid / open a URL), matching the click-to-open provider.
 * The overlay + keyboard-nav shell is `TerminalQuickpick`; this only defines the
 * row and what choosing one does.
 */
export function TerminalLinkQuickpick({
  items,
  onSelect,
  onClose,
}: {
  items: TerminalLinkItem[]
  onSelect: (item: TerminalLinkItem) => void
  onClose: () => void
}) {
  return (
    <TerminalQuickpick
      items={items}
      filter={filterTerminalLinks}
      placeholder="Open detected link…"
      ariaLabel="Filter terminal links"
      emptyText={items.length === 0 ? 'No links in terminal' : 'No matching links'}
      itemKey={(item, i) => `${item.kind}:${item.label}:${i}`}
      onChoose={(item) => onSelect(item)}
      onClose={onClose}
      renderRow={(item) => {
        const Icon = item.kind === 'file' ? FileText : LinkIcon
        const suffix =
          item.kind === 'file' && item.line
            ? `:${item.line}${item.column ? `:${item.column}` : ''}`
            : ''
        return (
          <>
            <Icon className="size-3.5 shrink-0 text-text-soft" aria-hidden />
            <span className="min-w-0 truncate font-mono text-foreground">
              {item.label}
              {suffix}
            </span>
            <span className="ml-auto shrink-0 text-2xs uppercase tracking-wide text-text-soft">
              {item.kind}
            </span>
          </>
        )
      }}
    />
  )
}
