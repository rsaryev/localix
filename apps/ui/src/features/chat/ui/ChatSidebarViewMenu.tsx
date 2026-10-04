import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { IconButton } from '@localixai/kit/icon-button'
import { ArrowDownUp, Layers3, ListFilter } from 'lucide-react'
import type { SessionGroupingMode } from '../model/sessionGrouping'
import type { SortMode } from '../model/useSidebarSessions'

/**
 * HOW THE CONVERSATION LIST IS SHOWN — grouping, order and archived visibility, in one menu.
 *
 * They were two icon buttons side by side, each drawing its picks differently: grouping as Radix
 * radio items, sorting as hand-placed trailing checks under a hand-drawn rule, and the archived
 * count folded into the toggle's label as "Show archived (2)". Three answers to one question —
 * what does this list look like — read as three unrelated controls. Now each axis is a submenu row
 * whose `hint` is the current pick (`keepOpen`, so choosing returns to the level that shows it),
 * and archived visibility is a real on/off toggle with its count as the trailing hint.
 */
interface ChatSidebarViewMenuProps {
  groupingMode: SessionGroupingMode
  onGroupingModeChange: (mode: SessionGroupingMode) => void
  sortMode: SortMode
  onSortModeChange: (mode: SortMode) => void
  showArchived: boolean
  onShowArchivedChange: (show: boolean) => void
  /** Count of archived root chats — the toggle's trailing hint. */
  archivedCount: number
}

const GROUPING_LABEL: Record<SessionGroupingMode, string> = {
  activity: 'Activity',
  agent: 'Agent',
}

const SORT_LABEL: Record<SortMode, string> = {
  recent: 'Recent',
  title: 'Title',
}

/** One axis's options as `selected` rows: choosing keeps the menu open on its parent level. */
function axisRows<T extends string>(
  labels: Record<T, string>,
  current: T,
  onChange: (value: T) => void,
): MenuEntry[] {
  return (Object.keys(labels) as T[]).map((value) => ({
    id: value,
    label: labels[value],
    selected: value === current,
    keepOpen: true,
    onSelect: () => {
      if (value !== current) onChange(value)
    },
  }))
}

export function chatSidebarViewEntries({
  groupingMode,
  onGroupingModeChange,
  sortMode,
  onSortModeChange,
  showArchived,
  onShowArchivedChange,
  archivedCount,
}: ChatSidebarViewMenuProps): MenuEntry[] {
  return [
    {
      id: 'group-by',
      label: 'Group by',
      icon: Layers3,
      hint: GROUPING_LABEL[groupingMode],
      items: axisRows(GROUPING_LABEL, groupingMode, onGroupingModeChange),
    },
    {
      id: 'sort-by',
      label: 'Sort by',
      icon: ArrowDownUp,
      hint: SORT_LABEL[sortMode],
      items: axisRows(SORT_LABEL, sortMode, onSortModeChange),
    },
    { separator: true },
    {
      id: 'show-archived',
      label: 'Show archived',
      checked: showArchived,
      hint: archivedCount > 0 ? String(archivedCount) : undefined,
      keepOpen: true,
      onSelect: () => onShowArchivedChange(!showArchived),
    },
  ]
}

/** The sidebar header's one view control. */
export function ChatSidebarViewMenu(props: ChatSidebarViewMenuProps) {
  return (
    <DropdownMenu>
      <ActionTooltip label="View options" side="bottom">
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" surface="sidebar" aria-label="Conversation view options">
            <ListFilter className="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" className="w-[190px]">
        <MenuEntries entries={chatSidebarViewEntries(props)} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
