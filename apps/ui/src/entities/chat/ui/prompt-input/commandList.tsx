/**
 * Built-in slash commands shown in the composer menu.
 *
 * The command DATA (names, titles, descriptions, categories, argument specs)
 * lives in ONE shared source of truth — `@localixai/api/slash-catalog`
 * (`SLASH_COMMANDS`), which the backend `/command` handlers also consume. This
 * module derives the web `SlashCommand[]` from that catalog,
 * layering on only the UI-side presentation the catalog intentionally omits:
 * an icon and an optional composer placeholder, keyed by command name.
 *
 * Rules:
 * - No hooks, no logic — pure data derivation.
 * - Hidden catalog commands (e.g. `/reload-plugins`, a Claude Code spelling of
 *   `/plugin reload`) are excluded from the menu; the API still accepts them when typed.
 */
import { SLASH_COMMANDS, type SlashCommandSpec } from '@localixai/api/slash-catalog'
import type { SlashCommand } from './SlashCommandMenu'
import {
  Activity,
  Bot,
  Brain,
  ClipboardList,
  Copy,
  Download,
  FilePlus2,
  FolderPlus,
  GitCompare,
  Gauge,
  Minimize2,
  History,
  MessageSquarePlus,
  Palette,
  Pencil,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Type,
  Undo2,
  Webhook,
} from 'lucide-react'
import {
  LoopIcon,
  ModelIcon,
  ForkIcon,
  UsageIcon,
  HelpIcon,
  MemoryIcon,
  SkillsIcon,
  McpIcon,
  PluginsIcon,
  MiniAppIcon,
  OpenIcon,
} from './commandIcons'

/**
 * Presentation-only overlay, keyed by the catalog command name. `icon` is the
 * menu glyph; `placeholder` refines the composer hint shown once the command is
 * active. Everything else comes from the shared catalog.
 */
interface CommandPresentation {
  icon: React.ReactNode
  placeholder?: string
}

const PRESENTATION: Record<string, CommandPresentation> = {
  agents: {
    icon: <Bot size={14} />,
    placeholder: 'list · create · edit · permissions…',
  },
  loop: { icon: <LoopIcon />, placeholder: 'Task — e.g. check the deployment every 5 minutes' },
  model: { icon: <ModelIcon />, placeholder: 'Pick an agent, a provider and a model…' },
  'output-style': {
    icon: <Type size={14} />,
    placeholder: 'A style name, default, or Enter to list the styles',
  },
  theme: { icon: <Palette size={14} />, placeholder: 'A theme, or Enter to list them' },
  effort: { icon: <Brain size={14} />, placeholder: 'Pick an agent and a reasoning level…' },
  plan: {
    icon: <ClipboardList size={14} />,
    placeholder: 'A task to plan, or Enter to switch to Plan mode',
  },
  permissions: {
    icon: <ShieldCheck size={14} />,
    placeholder: 'Press Enter to open the permission settings',
  },
  config: { icon: <Settings2 size={14} />, placeholder: 'Press Enter to open your preferences' },
  clear: {
    icon: <MessageSquarePlus size={14} />,
    placeholder: 'Press Enter to start a new chat in this project',
  },
  resume: { icon: <RotateCcw size={14} />, placeholder: 'A recent chat, or Enter to browse them' },
  rename: { icon: <Pencil size={14} />, placeholder: 'The new title of this chat' },
  rewind: { icon: <Undo2 size={14} />, placeholder: 'Pick the message to rewind to…' },
  copy: { icon: <Copy size={14} />, placeholder: 'Which reply, or Enter for the latest' },
  context: {
    icon: <Gauge size={14} />,
    placeholder: 'Press Enter to show how full the context is',
  },
  compact: {
    icon: <Minimize2 size={14} />,
    placeholder: 'What to keep in focus, or Enter to compact now',
  },
  init: {
    icon: <FilePlus2 size={14} />,
    placeholder: 'Press Enter to have the agent write CLAUDE.md',
  },
  status: { icon: <Activity size={14} />, placeholder: 'Press Enter to show this chat’s status' },
  hooks: { icon: <Webhook size={14} />, placeholder: 'Press Enter to list the configured hooks' },
  diff: { icon: <GitCompare size={14} />, placeholder: 'Press Enter to show uncommitted changes' },
  'add-dir': {
    icon: <FolderPlus size={14} />,
    placeholder: 'A folder: absolute, relative to the project, or ~/…',
  },
  export: {
    icon: <Download size={14} />,
    placeholder: 'A file name, or Enter for a Markdown file in the exports folder',
  },
  fork: { icon: <ForkIcon />, placeholder: 'Press Enter to fork this conversation' },
  open: { icon: <OpenIcon />, placeholder: 'Browse resources and UI anchors…' },
  help: { icon: <HelpIcon />, placeholder: 'A command, or Enter to list them all' },
  recap: { icon: <History size={14} />, placeholder: 'Press Enter to sum up this chat' },
  usage: { icon: <UsageIcon />, placeholder: 'Press Enter to show usage & cost' },
  memory: { icon: <MemoryIcon />, placeholder: 'A fact to remember, or Enter to list memories' },
  skills: { icon: <SkillsIcon />, placeholder: 'Press Enter to list your skills' },
  mcp: { icon: <McpIcon />, placeholder: 'Press Enter to list MCP servers' },
  plugin: {
    icon: <PluginsIcon />,
    placeholder: 'list · install <src> · enable/disable/remove <name> · reload · marketplace …',
  },
  'mini-app': {
    icon: <MiniAppIcon />,
    placeholder: 'list · create · enable · disable · remove · reload · catalog',
  },
}

function toSlashCommand(spec: SlashCommandSpec): SlashCommand {
  const presentation = PRESENTATION[spec.name] ?? { icon: <HelpIcon /> }
  return {
    id: spec.name,
    trigger: spec.name,
    title: spec.title,
    description: spec.description,
    icon: presentation.icon,
    // argless commands run on Enter (no trailing space); the rest open for input.
    prefix: spec.argless ? `/${spec.name}` : `/${spec.name} `,
    placeholder: presentation.placeholder,
    argless: spec.argless,
    category: spec.category,
    args: spec.args,
  }
}

/**
 * The composer's built-in commands, derived from the shared catalog. Hidden
 * commands are filtered out; ordering follows the catalog (already grouped by
 * category) so both the flat keyboard navigation and the grouped rendering in
 * SlashCommandMenu stay consistent.
 */
export const ALL_SLASH_COMMANDS: SlashCommand[] = SLASH_COMMANDS.flatMap((c) =>
  c.hidden ? [] : [toSlashCommand(c)],
)
