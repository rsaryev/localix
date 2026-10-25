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
 * - Hidden catalog commands (e.g. `/reasoning`) are excluded from the menu; the
 *   API still accepts them when typed directly.
 * - `/yolo` is intentionally absent: use `/mode yolo` instead.
 * - `/reasoning` is absent from the menu: the Effort picker in the composer
 *   handles it in the UI.
 */
import { SLASH_COMMANDS, type SlashCommandSpec } from '@localixai/api/slash-catalog'
import type { SlashCommand } from './SlashCommandMenu'
import { Bot, History, Palette, Type } from 'lucide-react'
import {
  LoopIcon,
  ModelIcon,
  CompactIcon,
  ClearIcon,
  ForkIcon,
  UsageIcon,
  HelpIcon,
  MemoryIcon,
  SkillsIcon,
  McpIcon,
  PluginsIcon,
  ProvidersIcon,
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
    placeholder: 'list · create · edit · permissions · add · remove…',
  },
  loop: { icon: <LoopIcon />, placeholder: 'Task — e.g. check the deployment every 5 minutes' },
  model: { icon: <ModelIcon />, placeholder: 'Pick an agent, a provider and a model…' },
  'output-style': {
    icon: <Type size={14} />,
    placeholder: 'A style name, default, or Enter to list the styles',
  },
  theme: { icon: <Palette size={14} />, placeholder: 'A theme, or Enter to list them' },
  compact: { icon: <CompactIcon />, placeholder: 'Press Enter to compact the conversation' },
  clear: { icon: <ClearIcon />, placeholder: 'Press Enter to clear context' },
  fork: { icon: <ForkIcon />, placeholder: 'Press Enter to fork this conversation' },
  open: { icon: <OpenIcon />, placeholder: 'Browse resources and UI anchors…' },
  help: { icon: <HelpIcon />, placeholder: 'Press Enter to list all commands' },
  recap: { icon: <History size={14} />, placeholder: 'Press Enter to sum up this chat' },
  usage: { icon: <UsageIcon />, placeholder: 'Press Enter to show usage & cost' },
  memory: { icon: <MemoryIcon />, placeholder: 'A fact to remember, or Enter to list memories' },
  skills: { icon: <SkillsIcon />, placeholder: 'Press Enter to list your skills' },
  mcp: { icon: <McpIcon />, placeholder: 'Press Enter to list MCP servers' },
  plugin: {
    icon: <PluginsIcon />,
    placeholder: 'list · install <src> · enable/disable/remove <name> · reload · marketplace …',
  },
  provider: { icon: <ProvidersIcon />, placeholder: 'list · install <src> · remove <name>' },
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
