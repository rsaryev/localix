import {
  FileText,
  GitCompare,
  Globe,
  Puzzle,
  BarChart3,
  TriangleAlert,
  Settings,
  SquareTerminal,
  ScrollText,
  MessageSquare,
  File,
  History,
  Search,
  Bot,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  activeWorkItemContribution,
  type CoreWorkItemKind,
  type WorkItemKind,
} from '@/entities/workspace-grid/model'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** Per-kind tab icon for the grid tab strip. Kept out of registry.tsx so that
 *  file only exports a component (React Fast Refresh stays enabled there). */
const KIND_ICONS: Record<CoreWorkItemKind, typeof FileText> = {
  chat: MessageSquare,
  transcript: ScrollText,
  file: FileText,
  diff: GitCompare,
  preview: Globe,
  'plugin-view': Puzzle,
  'live-file-change': File,
  agent: Bot,
  stats: BarChart3,
  problems: TriangleAlert,
  settings: Settings,
  terminal: SquareTerminal,
  'message-replay': History,
  'global-search': Search,
}

/** `tintClass` is an optional text-color class (e.g. a connection's color tag), so a
 *  db-console tab's icon signals its color right in the tab strip. */
export function workItemIcon(kind: WorkItemKind, tintClass?: string | null): ReactNode {
  // Plugin-exclusive contributions supply their own icon. Reserved core kinds
  // always retain the built-in table.
  const Icon =
    activeWorkItemContribution(kind)?.Icon ?? KIND_ICONS[kind as CoreWorkItemKind] ?? FileText
  return <Icon className={cn('size-3.5', tintClass)} />
}
