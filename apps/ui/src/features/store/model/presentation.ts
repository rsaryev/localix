import {
  Bot,
  Boxes,
  Compass,
  Cpu,
  Download,
  LayoutGrid,
  MonitorSmartphone,
  Package,
  Palette,
  Plug,
  RefreshCw,
  ScrollText,
  Server,
  Sparkles,
  SquareTerminal,
  Wand2,
  Webhook,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import {
  BROWSABLE_COMPONENT_KINDS,
  componentCount,
  type ComponentKind,
  type Listing,
  type PackageKind,
} from '@localixai/store'

/**
 * How the Store names and draws what the contract carries: a label and a glyph per package kind
 * and per component kind (`docs/internals/store.md`, principle 7). It names no provider: a new
 * kind is one row here.
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
  'mini-app': { group: 'Mini app catalogs', one: 'mini app catalog' },
  plugin: { group: 'Claude Code marketplaces', one: 'marketplace' },
  'mcp-server': { group: 'MCP registries', one: 'MCP registry' },
  skill: { group: 'Skill registries', one: 'skill registry' },
  agent: { group: 'Agent registries', one: 'agent registry' },
}

/** The shelves that are not a kind: their label and glyph. */
export const LIBRARY_LABELS = {
  discover: { label: 'Discover', icon: Compass },
  installed: { label: 'Installed', icon: Package },
  updates: { label: 'Updates', icon: RefreshCw },
  sources: { label: 'Sources', icon: Download },
} as const

/** How the Store names each category a package declares. */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  games: 'Games',
  data: 'Data',
  development: 'Development',
  content: 'Content',
  utilities: 'Utilities',
}

/** The shelf heading of a component kind: "Commands", "Agent tools". */
export function capabilityLabel(kind: ComponentKind): string {
  const { one, many } = COMPONENT_LABELS[kind]
  return one === 'Agent tools' ? one : many[0]!.toUpperCase() + many.slice(1)
}

/** A label inside a sentence: "mini app", but "MCP server" keeps its capitals. */
export const inSentence = (label: string) => (/^[A-Z]{2}/.test(label) ? label : label.toLowerCase())

/**
 * What a card says is inside, only where it tells the package apart from the others of its kind
 * in `peers`: the browsable components it has that not every one of them has ("2 commands").
 * How a package works — a screen, a backend, agent tools — and whether it runs code are on its
 * page, not on every card.
 */
export function distinctInside(listing: Listing, peers: readonly Listing[]): string {
  if (listing.contents === 'unknown') return ''
  const kin = peers.filter((peer) => peer.ref.kind === listing.ref.kind)
  return BROWSABLE_COMPONENT_KINDS.flatMap((kind) => {
    const count = componentCount(listing, kind)
    if (!count || (kin.length > 1 && kin.every((peer) => componentCount(peer, kind) > 0))) return []
    const { one, many } = COMPONENT_LABELS[kind]
    return [count === 1 ? `1 ${inSentence(one)}` : `${count} ${many}`]
  }).join(' · ')
}

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`
