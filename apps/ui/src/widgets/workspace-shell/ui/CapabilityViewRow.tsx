import { useState } from 'react'
import { EllipsisVertical } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowLeading,
  WorkbenchListRowText,
  WorkbenchListRowTrigger,
} from '@localixai/kit/workbench-list-row'
import type { RailEntry } from './shellTypes'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
} from '@localixai/plugin-sdk/ui/message-binding-drag'

/**
 * One plugin view as a launcher row.
 *
 * Clicking opens the view. Dragging carries the view as an agent-context resource into the
 * composer; it no longer drags onto the rail, because plugin views are not pinnable — the
 * rail surfaces them through its recent slots instead.
 *
 * `menu` is reached two ways — the hover action button and a right-click anywhere on the row —
 * from the one list `pluginEntryMenuEntries` describes.
 */
export function CapabilityViewRow({
  entry,
  menu,
  indent = false,
}: {
  entry: RailEntry
  menu?: readonly MenuEntry[]
  /** Nested under its owning plugin's row rather than a top-level entry. */
  indent?: boolean
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const row = (
    <WorkbenchListRow
      density="compact"
      active={entry.active}
      data-plugin-entry-id={entry.id}
      className={indent ? 'pl-6' : undefined}
    >
      <ActionTooltip
        label={entry.label}
        side="right"
        open={tooltipOpen}
        onOpenChange={setTooltipOpen}
      >
        <WorkbenchListRowTrigger
          type="button"
          draggable={Boolean(entry.resourceUri)}
          aria-current={entry.active ? 'page' : undefined}
          onDragStart={(event) => {
            if (!entry.resourceUri) return
            setTooltipOpen(false)
            setMessageBindingDrag(
              event.dataTransfer,
              createMessageBindingDraft('resource', entry.resourceUri, entry.label),
            )
          }}
          onClick={entry.onClick}
        >
          <WorkbenchListRowLeading>{entry.icon}</WorkbenchListRowLeading>
          <WorkbenchListRowText title={entry.label} />
        </WorkbenchListRowTrigger>
      </ActionTooltip>
      {menu?.length ? (
        // Stays visible while its menu is open, so the menu does not hang off an empty slot.
        <WorkbenchListRowActions
          aria-label={`${entry.label} actions`}
          visibility="hover"
          className={menuOpen ? 'opacity-100' : undefined}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" surface="sidebar" aria-label={`${entry.label} actions`}>
                <EllipsisVertical className="size-3.5" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[210px]">
              <MenuEntries entries={menu} family="dropdown" />
            </DropdownMenuContent>
          </DropdownMenu>
        </WorkbenchListRowActions>
      ) : null}
    </WorkbenchListRow>
  )
  if (!menu?.length) return row
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) setTooltipOpen(false)
      }}
    >
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-[210px]">
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
