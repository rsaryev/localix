import {
  BookOpen,
  Bot,
  Boxes,
  Code2,
  Compass,
  Cpu,
  Database,
  Download,
  FileText,
  FolderOpen,
  Gamepad2,
  LayoutGrid,
  ListTodo,
  MonitorSmartphone,
  Package,
  Palette,
  Plug,
  RefreshCw,
  ScrollText,
  Server,
  ServerCog,
  Shapes,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Wand2,
  Webhook,
  Wrench,
  type LucideIcon,
  UserRound,
} from 'lucide-react'
import type { ComponentKind, Listing, PackageKind, StoreCategory, Trust } from '@localixai/store'

/**
 * How the Store names and draws what the contract carries: a label and a glyph per package kind,
 * component kind, category and trust (`docs/internals/store.md`, principle 7). It names no
 * provider: a new kind is one row here.
 */

export const KIND_LABELS: Record<PackageKind, { one: string; many: string; icon: LucideIcon }> = {
  'mini-app': { one: 'Mini app', many: 'Mini apps', icon: LayoutGrid },
  plugin: { one: 'Plugin', many: 'Plugins', icon: Plug },
  'mcp-server': { one: 'MCP server', many: 'MCP servers', icon: Server },
  skill: { one: 'Skill', many: 'Skills', icon: Sparkles },
  agent: { one: 'Agent', many: 'Agents', icon: Bot },
}

export const COMPONENT_LABELS: Record<
  ComponentKind,
  { one: string; many: string; icon: LucideIcon }
> = {
  skill: { one: 'Skill', many: 'skills', icon: Sparkles },
  agent: { one: 'Agent', many: 'agents', icon: Bot },
  command: { one: 'Command', many: 'commands', icon: SquareTerminal },
  hook: { one: 'Hook', many: 'hooks', icon: Webhook },
  mod: { one: 'Mod', many: 'mods', icon: Wand2 },
  'mcp-server': { one: 'MCP server', many: 'MCP servers', icon: Server },
  'lsp-server': { one: 'LSP server', many: 'LSP servers', icon: Cpu },
  'output-style': { one: 'Output style', many: 'output styles', icon: ScrollText },
  monitor: { one: 'Monitor', many: 'monitors', icon: Boxes },
  theme: { one: 'Theme', many: 'themes', icon: Palette },
  screen: { one: 'Screen', many: 'screens', icon: MonitorSmartphone },
  backend: { one: 'Backend', many: 'backends', icon: Cpu },
  'agent-tool': { one: 'Agent tools', many: 'agent tools', icon: Wrench },
}

/** What a package kind's sources are called: a group heading and one of them. */
export const SOURCE_LABELS: Record<PackageKind, { group: string; one: string }> = {
  'mini-app': { group: 'Mini app catalogs', one: 'Mini app catalog' },
  plugin: { group: 'Claude Code marketplaces', one: 'Claude Code marketplace' },
  'mcp-server': { group: 'MCP registries', one: 'MCP registry' },
  skill: { group: 'Skill registries', one: 'Skill registry' },
  agent: { group: 'Agent registries', one: 'Agent registry' },
}

/** The sections that are not a kind: their label and glyph. */
export const LIBRARY_LABELS = {
  discover: { label: 'Discover', icon: Compass },
  installed: { label: 'Installed', icon: Package },
  updates: { label: 'Updates', icon: RefreshCw },
  yours: { label: 'Yours', icon: UserRound },
  project: { label: 'Project', icon: FolderOpen },
  sources: { label: 'Sources', icon: Download },
} as const

export const CATEGORY_ICONS: Record<StoreCategory, LucideIcon> = {
  Development: Code2,
  Data: Database,
  Content: FileText,
  Productivity: ListTodo,
  Design: Palette,
  Security: ShieldCheck,
  Operations: ServerCog,
  Learning: BookOpen,
  Games: Gamepad2,
  Utilities: Wrench,
  Other: Shapes,
}

/** Who stands behind a source: Localix and Anthropic's official one are verified. */
export const TRUST_LABELS: Record<Trust, string> = {
  localix: 'Localix',
  official: 'Official',
  community: 'Community',
}

/**
 * What the listing's source says of itself. None for what has no source to rate — the person's own
 * items, built-in types, files of theirs: the provider leaves `trust` out and nothing is labelled.
 */
export const trustOf = (listing: Pick<Listing, 'source'>): Trust | undefined => listing.source.trust

export const isVerified = (listing: Pick<Listing, 'source'>) => {
  const trust = trustOf(listing)
  return trust === 'localix' || trust === 'official'
}

/** The shelf heading of a component kind: "Commands", "Agent tools". */
export function capabilityLabel(kind: ComponentKind): string {
  const { one, many } = COMPONENT_LABELS[kind]
  return one === 'Agent tools' ? one : many[0]!.toUpperCase() + many.slice(1)
}

/** A label inside a sentence: "mini app", but "MCP server" keeps its capitals. */
export const inSentence = (label: string) => (/^[A-Z]{2}/.test(label) ? label : label.toLowerCase())

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`

/** "3 hours ago", "2 days ago", "just now": how long since `iso`, for a source's last read. */
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  const steps: [number, string][] = [
    [60 * 60 * 24 * 30, 'month'],
    [60 * 60 * 24, 'day'],
    [60 * 60, 'hour'],
    [60, 'minute'],
  ]
  for (const [size, unit] of steps) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count} ${unit}${count === 1 ? '' : 's'} ago`
  }
  return 'just now'
}
