import { Archive, ArchiveRestore, Copy, FileDiff, Trash2 } from 'lucide-react'
import type { RepoStash } from '../../../backend/source-control/contracts'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { BulkAction } from './sourceControlParts'
import { WorkbenchListRow } from '@localixai/kit/workbench-list-row'

export interface StashActions {
  /** Restore a stash and remove it from the stack (`git stash pop`). */
  onPop: (index: number) => void
  /** Restore a stash but keep it on the stack (`git stash apply`). */
  onApply: (index: number) => void
  /** Discard a stash without restoring it (asks to confirm — destructive). */
  onDrop: (stash: RepoStash) => void
  /** Open the stash's diff in an inspector diff tab (row click / Enter). */
  onView: (stash: RepoStash) => void
}

/**
 * Small hover action on a stash row — the shared Source Control `BulkAction`
 * icon button, with the row's click/keys stopped from bubbling to the row's own
 * diff-open handler.
 */
function RowAction({
  title,
  danger,
  onClick,
  children,
}: {
  title: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <BulkAction
      title={title}
      danger={danger}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
      }}
    >
      {children}
    </BulkAction>
  )
}

/**
 * Collapsible list of saved stashes (newest first). Each row shows the stash
 * label + how long ago it was saved; clicking (or Enter/Space) opens its diff.
 * Hovering/focusing reveals Pop (restore & remove), Apply (restore & keep), and
 * Drop (discard) — and right-click offers the same three, because the hover cluster also has to
 * share the row's trailing edge with the saved-at stamp and swaps it out to fit. Rendered only
 * when there are stashes — a clean tree with no stashes shows nothing.
 */
export function StashesSection({
  stashes,
  actions,
}: {
  stashes: RepoStash[]
  actions: StashActions
}) {
  if (stashes.length === 0) return null
  return (
    <CollapsibleSection title="Stashes" count={stashes.length} defaultOpen={false}>
      {stashes.map((stash) => (
        <ContextMenu key={stash.index}>
          <ContextMenuTrigger asChild>
            <WorkbenchListRow
              density="dense"
              className="group/stash min-w-0 gap-1.5 rounded-none px-2"
              title={stash.message}
            >
              {/* The row is a plain container; its primary action lives on a dedicated
              focusable button so the action buttons stay valid siblings in the a11y tree. */}
              <button
                type="button"
                onClick={() => actions.onView(stash)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-ring"
              >
                <Archive className="size-4 shrink-0 text-text-faint" />
                <span className="min-w-0 truncate">{stash.message}</span>
              </button>
              {/* Date and hover actions share ONE grid cell, right-aligned. Side by side, the
                  date kept its width while faded out, so the actions sat a date's width away
                  from the edge next to a blank gap. */}
              <span className="grid shrink-0 items-center justify-items-end">
                <span className="lx-hover-actions flex items-center gap-0.5 opacity-0 transition-opacity [grid-area:1/1] group-hover/stash:opacity-100 group-focus-within/stash:opacity-100">
                  <RowAction
                    title="Pop (restore and remove)"
                    onClick={() => actions.onPop(stash.index)}
                  >
                    <ArchiveRestore className="size-3.5" />
                  </RowAction>
                  <RowAction
                    title="Apply (restore and keep)"
                    onClick={() => actions.onApply(stash.index)}
                  >
                    <Copy className="size-3.5" />
                  </RowAction>
                  <RowAction title="Drop (discard)" danger onClick={() => actions.onDrop(stash)}>
                    <Trash2 className="size-3.5" />
                  </RowAction>
                </span>
                {stash.relativeDate && (
                  <span className="pointer-events-none text-2xs text-text-faint opacity-100 transition-opacity [grid-area:1/1] group-hover/stash:opacity-0 group-focus-within/stash:opacity-0">
                    {stash.relativeDate}
                  </span>
                )}
              </span>
            </WorkbenchListRow>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <MenuEntries entries={stashMenu(stash, actions)} family="context" />
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </CollapsibleSection>
  )
}

/** The three things a stash can do, in the order the hover cluster shows them. */
function stashMenu(stash: RepoStash, actions: StashActions): MenuEntry[] {
  return [
    { id: 'view', label: 'Open diff', icon: FileDiff, onSelect: () => actions.onView(stash) },
    { separator: true },
    {
      id: 'pop',
      label: 'Pop (restore and remove)',
      icon: ArchiveRestore,
      onSelect: () => actions.onPop(stash.index),
    },
    {
      id: 'apply',
      label: 'Apply (restore and keep)',
      icon: Copy,
      onSelect: () => actions.onApply(stash.index),
    },
    { separator: true },
    {
      id: 'drop',
      label: 'Drop (discard)…',
      icon: Trash2,
      danger: true,
      onSelect: () => actions.onDrop(stash),
    },
  ]
}
