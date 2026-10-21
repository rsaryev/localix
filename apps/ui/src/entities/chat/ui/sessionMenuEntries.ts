import {
  Archive,
  ArchiveRestore,
  Download,
  EyeOff,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import type { UiSession } from '@/shared/api/contracts'

/**
 * Everything you can do to a conversation, described once.
 *
 * The sidebar row offers these two ways — its action button, and a right-click
 * anywhere on the row. Writing the list twice is how the two would drift, and a right-click menu
 * that is a subset of the kebab's is worse than none: it teaches that right-click is unreliable.
 *
 * Pin/Unpin and Archive/Unarchive live here rather than in a floating button cluster,
 * so narrow sidebar rows have the same readable content and action slot as wide ones.
 */
export interface SessionMenuOps {
  onToggleUnread: (id: string) => void
  onStartRename: () => void
  onExport: () => void
  onExportRedacted: () => void
  onTogglePin: (id: string) => void
  onToggleArchive: () => void
  onDelete: (id: string) => void
}

export function sessionMenuEntries(session: UiSession, ops: SessionMenuOps): MenuEntry[] {
  return [
    {
      id: 'unread',
      label: session.isUnread ? 'Mark as read' : 'Mark as unread',
      icon: MessageSquare,
      onSelect: () => ops.onToggleUnread(session.id),
    },
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: ops.onStartRename },
    {
      id: 'pin',
      label: session.isPinned ? 'Unpin' : 'Pin',
      icon: session.isPinned ? PinOff : Pin,
      onSelect: () => ops.onTogglePin(session.id),
    },
    {
      id: 'archive',
      label: session.isArchived ? 'Unarchive' : 'Archive',
      icon: session.isArchived ? ArchiveRestore : Archive,
      onSelect: ops.onToggleArchive,
    },
    { separator: true },
    { id: 'export', label: 'Export as Markdown', icon: Download, onSelect: ops.onExport },
    {
      id: 'export-redacted',
      label: 'Export redacted',
      icon: EyeOff,
      onSelect: ops.onExportRedacted,
    },
    { separator: true },
    {
      id: 'delete',
      label: 'Delete conversation',
      icon: Trash2,
      danger: true,
      onSelect: () => ops.onDelete(session.id),
    },
  ]
}
