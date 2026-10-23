import type { Project, UiSession } from '@/shared/api/contracts'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { Archive, ArchiveRestore, FolderInput, MessageSquare, Pin, Trash2, X } from 'lucide-react'
import { NO_PROJECT, PROJECT_ICON } from '@/shared/ui/projectPresentation'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { IconButton } from '@localixai/kit/icon-button'

interface SessionBatchBarProps {
  /** The currently-selected root chats (already filtered to existing sessions). */
  sessions: UiSession[]
  /** Projects the selection can be moved into. */
  projects: Project[]
  onArchive: () => void
  onPin: () => void
  onMarkUnread: () => void
  onMoveToProject: (projectId: string | null) => void
  onDelete: () => void
  onClear: () => void
}

function BatchButton({
  label,
  onClick,
  icon,
  tone = 'default',
}: {
  label: string
  onClick: () => void
  icon: React.ReactNode
  tone?: 'default' | 'destructive'
}) {
  return (
    <IconButton
      surface="sidebar"
      size="md"
      onClick={onClick}
      aria-label={label}
      tooltip={label}
      tone={tone === 'destructive' ? 'danger' : 'default'}
    >
      {icon}
    </IconButton>
  )
}

/**
 * The bulk-action bar that docks at the sidebar's foot whenever one or more root
 * chats are multi-selected. Labels adapt to the selection (Archive↔Unarchive,
 * Pin↔Unpin, Mark unread↔read) so a single button covers both directions.
 */
export function SessionBatchBar({
  sessions,
  projects,
  onArchive,
  onPin,
  onMarkUnread,
  onMoveToProject,
  onDelete,
  onClear,
}: SessionBatchBarProps) {
  const count = sessions.length
  if (count === 0) return null

  const allArchived = sessions.every((s) => s.isArchived)
  const allPinned = sessions.every((s) => s.isPinned)
  const anyUnread = sessions.some((s) => s.isUnread)
  // Highlight the current project only when the whole selection already shares it.
  const firstProjectId = sessions[0].projectId ?? null
  const commonProjectId = sessions.every((s) => (s.projectId ?? null) === firstProjectId)
    ? firstProjectId
    : undefined
  // One choice among projects: `selected` rows keep each target's glyph in front and mark the
  // shared current one at the end. They were hand-built rows with a House on "No project" and a
  // trailing check of their own, a look no other pick in the app had.
  const moveEntries: MenuEntry[] = [
    {
      id: 'no-project',
      label: NO_PROJECT.label,
      icon: NO_PROJECT.icon,
      selected: commonProjectId === null,
      onSelect: () => onMoveToProject(null),
    },
    ...projects.map((project) => ({
      id: project.id,
      label: project.name,
      icon: PROJECT_ICON,
      selected: commonProjectId === project.id,
      onSelect: () => onMoveToProject(project.id),
    })),
  ]

  return (
    <div className="shrink-0 border-t border-sidebar-border/40 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <IconButton
            size="sm"
            surface="sidebar"
            onClick={onClear}
            aria-label="Clear selection"
            tooltip="Clear selection"
          >
            <X className="size-3.5" />
          </IconButton>
          <span className="truncate text-xs font-medium text-sidebar-foreground/80">
            {count} selected
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <BatchButton
            label={anyUnread ? 'Mark as read' : 'Mark as unread'}
            onClick={onMarkUnread}
            icon={<MessageSquare className="size-3.5" />}
          />
          <BatchButton
            label={allPinned ? 'Unpin' : 'Pin'}
            onClick={onPin}
            icon={<Pin className={['size-3.5', allPinned ? 'fill-current' : ''].join(' ')} />}
          />
          <BatchButton
            label={allArchived ? 'Unarchive' : 'Archive'}
            onClick={onArchive}
            icon={
              allArchived ? (
                <ArchiveRestore className="size-3.5" />
              ) : (
                <Archive className="size-3.5" />
              )
            }
          />
          <DropdownMenu>
            <ActionTooltip label="Move to project" side="top">
              <DropdownMenuTrigger asChild>
                <IconButton surface="sidebar" size="md" aria-label="Move to project">
                  <FolderInput className="size-3.5" />
                </IconButton>
              </DropdownMenuTrigger>
            </ActionTooltip>
            <DropdownMenuContent align="end" className="min-w-44">
              <MenuEntries entries={moveEntries} family="dropdown" />
            </DropdownMenuContent>
          </DropdownMenu>
          <BatchButton
            label="Delete"
            onClick={onDelete}
            icon={<Trash2 className="size-3.5" />}
            tone="destructive"
          />
        </div>
      </div>
    </div>
  )
}
