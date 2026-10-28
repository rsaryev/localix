import { createElement } from 'react'
import {
  Box,
  FileDiff,
  FileText,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  History,
  MessagesSquare,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react'
import { resourceRefIcon } from '@/shared/contrib/iconContributions'

const RESOURCE_ICONS: Record<string, LucideIcon> = {
  repo: FolderGit2,
  'git-branch': GitBranch,
  'git-commit': GitCommitHorizontal,
  history: History,
  file: FileText,
  'file-diff': FileDiff,
  project: FolderGit2,
  session: MessagesSquare,
  message: MessageSquareText,
}

/** Registry-aware icon for resource-provider nodes, with a neutral fallback. */
export function ResourceGlyph({ icon }: { icon?: string }) {
  const key = icon ?? ''
  const Icon = RESOURCE_ICONS[key] ?? resourceRefIcon(key) ?? Box
  // The icon is a lookup in stable registries, not a component made here; `createElement` says so.
  return createElement(Icon, { className: 'size-3.5 text-text-soft' })
}
