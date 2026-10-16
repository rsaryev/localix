import { createElement, type ReactNode } from 'react'
import {
  Search,
  Folder,
  MessageSquare,
  MessagesSquare,
  FileText,
  Image,
  Puzzle,
  Sparkles,
  KeyRound,
  Plug,
  Cpu,
  Settings,
  Command,
  Table,
  ScrollText,
  Bot,
} from 'lucide-react'
import { searchDomainIcon } from '@/shared/contrib/searchDomains'
import { resourceRefIcon } from '@/shared/contrib/iconContributions'

/**
 * Glyph vocabulary for search scopes + hits — one string→icon map so the workspace tab
 * and the ⌘⇧F palette render the same iconography. Keys match `ScopeDef.icon` and the
 * backend `SearchHit.icon` (reused from the composer's RESOURCE_ICONS vocabulary).
 * Subsystem-specific glyphs (a container workbench, …) are contributed via the open
 * search-domain registry, consulted after this core map.
 */
const ICONS: Record<string, typeof Search> = {
  search: Search,
  project: Folder,
  session: MessageSquare,
  subsession: MessagesSquare,
  message: MessageSquare,
  file: FileText,
  image: Image,
  plugin: Puzzle,
  skill: Sparkles,
  key: KeyRound,
  mcp: Plug,
  provider: Cpu,
  agent: Bot,
  settings: Settings,
  command: Command,
  table: Table,
  logs: ScrollText,
}

/** Resolve an icon key → a lucide component, falling back to the magnifier. */
function searchIcon(key: string | undefined | null): typeof Search {
  if (!key) return Search
  return ICONS[key] ?? searchDomainIcon(key) ?? resourceRefIcon(key) ?? Search
}

/**
 * Render an icon element for a key. A plain helper (not a component) so callers don't
 * alias a component to a render-local `const Icon` — which the static-components lint
 * rule flags — mirroring `workItemIcon`.
 */
export function searchIconEl(key: string | undefined | null, className: string): ReactNode {
  return createElement(searchIcon(key), { className })
}
