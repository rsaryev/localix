// THE single declarative catalog of built-in slash commands — one source of truth, so a
// name, alias or description cannot drift between the surfaces that show it and the code
// that runs it. Everything downstream is DERIVED from this array, never re-typed from it:
//   - `BUILTIN_COMMAND_NAMES` below (the guard that stops a user skill shadowing a
//     built-in),
//   - the parser's word→handler map (`service/slash-commands.ts` — a `scope: 'server'`
//     entry here IS its parse case; `scope: 'client'` entries like `/fork` are skipped
//     there, and aliases come along for free),
//   - the web composer menu (which adds only icons).
//
// Browser-safe catalog: argument definitions, the arg-spec core and pure edit distance
// keep consumers independent of server code.

import { LOOP_ARGS, MINI_APP_ARGS, PLUGIN_ARGS, THEME_ARGS } from './slash-catalog-arguments'
import type { SlashArgSpec } from './slash-args'
import { AGENTS_ARGS } from './slash-catalog-agents'
import { MCP_ARGS } from './slash-catalog-mcp'
import { CLAUDE_CODE_COMMANDS } from './slash-catalog-claude-code-commands'
import { MODEL_ARGS } from './slash-catalog-model'
import {
  COPY_ARGS,
  EFFORT_ARGS,
  HELP_ARGS,
  MEMORY_ARGS,
  OUTPUT_STYLE_ARGS,
  PLAN_ARGS,
  RENAME_ARGS,
  RESUME_ARGS,
  REWIND_ARGS,
} from './slash-catalog-claude-code'

/**
 * Ordered category catalog — the single source for grouping commands into
 * scannable sections. Both the `/help` reference and any grouped menu render from
 * this, so the sections can never drift from code comments.
 */
export const SLASH_CATEGORIES = [
  { id: 'autonomous', label: 'Autonomous' },
  { id: 'config', label: 'Configuration' },
  { id: 'context', label: 'Context' },
  { id: 'info', label: 'Info' },
  { id: 'memory', label: 'Memory & skills' },
  { id: 'extensions', label: 'Extensions' },
] as const

export type SlashCategoryId = (typeof SLASH_CATEGORIES)[number]['id']

export interface SlashCommandSpec {
  /** Canonical command name WITHOUT the leading slash, e.g. `clear`. */
  name: string
  /** Alternate names that fold into the same command (e.g. `cost` → `usage`). */
  aliases?: string[]
  /** Short title for menus. */
  title: string
  /** One-line description shown in command menus. */
  description: string
  /** True when the command takes no arguments (Enter runs it). */
  argless?: boolean
  /** Where it's handled: `server` = `parseControlCommand`; `client` = a surface intercepts it. */
  scope: 'server' | 'client'
  /** Which `/help` section the command lives in (also drives grouped menus). */
  category: SlashCategoryId
  /** Accepted when typed, but hidden from menus (power-user commands). */
  hidden?: boolean
  /** Declarative argument specs — drive the composer's inline arg hints/menus. */
  args?: SlashArgSpec[]
}

export const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  // Autonomous
  {
    name: 'loop',
    title: 'Loop',
    description:
      'Repeat a task on a schedule — /loop <task>; the agent derives the cadence from the text (or self-paces)',
    scope: 'server',
    category: 'autonomous',
    args: LOOP_ARGS,
  },
  // Configuration
  {
    name: 'agents',
    title: 'Agents',
    description: 'List agents; they are managed in the Store',
    scope: 'server',
    category: 'config',
    args: AGENTS_ARGS,
  },
  {
    name: 'model',
    aliases: ['models'],
    title: 'Model',
    description: 'Switch an agent’s model step by step, as in the picker — or /model <name>',
    scope: 'server',
    category: 'config',
    args: MODEL_ARGS,
  },
  {
    // A shortcut into `/model`'s steps, at the reasoning level (`model-command/`).
    name: 'effort',
    title: 'Effort',
    description: 'Set an agent’s reasoning level on the model it runs — /model’s steps, shortened',
    scope: 'client',
    category: 'config',
    args: EFFORT_ARGS,
  },
  {
    name: 'output-style',
    title: 'Output style',
    description:
      'Change how replies sound and look — Concise, Explanatory, Learning — or list them',
    scope: 'server',
    category: 'config',
    args: OUTPUT_STYLE_ARGS,
  },
  {
    // The look is this device's, so the composer runs it (`apps/ui/src/shared/theme/themeChoice`).
    name: 'theme',
    title: 'Theme',
    description: 'Switch the appearance or a plugin’s color theme — or list them',
    scope: 'client',
    category: 'config',
    args: THEME_ARGS,
  },
  {
    name: 'plan',
    title: 'Plan',
    description: 'Switch this chat to Plan mode — /plan <task> also sends the task',
    scope: 'client',
    category: 'config',
    args: PLAN_ARGS,
  },
  {
    name: 'permissions',
    title: 'Permissions',
    description: 'Open Settings at the permissions',
    scope: 'client',
    category: 'config',
    argless: true,
  },
  {
    name: 'config',
    title: 'Config',
    description: 'Open Settings at your preferences',
    scope: 'client',
    category: 'config',
    argless: true,
  },
  // Context management
  {
    name: 'clear',
    title: 'Clear',
    description: 'Start a new chat in this project, with an empty context',
    scope: 'client',
    category: 'context',
    argless: true,
  },
  {
    name: 'resume',
    title: 'Resume',
    description: 'Open a recent chat — /resume <chat>, or browse them all',
    scope: 'client',
    category: 'context',
    args: RESUME_ARGS,
  },
  {
    name: 'rename',
    title: 'Rename',
    description: 'Give this chat a title — /rename <title>',
    scope: 'client',
    category: 'context',
    args: RENAME_ARGS,
  },
  {
    name: 'rewind',
    title: 'Rewind',
    description: 'Roll this chat back to one of your messages; its text returns to the composer',
    scope: 'client',
    category: 'context',
    args: REWIND_ARGS,
  },
  {
    name: 'copy',
    title: 'Copy',
    description: 'Copy the latest reply — /copy <n> for an earlier one',
    scope: 'client',
    category: 'context',
    args: COPY_ARGS,
  },
  {
    name: 'fork',
    title: 'Fork',
    description: 'Duplicate this conversation into a new chat to take in a different direction',
    scope: 'client',
    category: 'context',
    argless: true,
  },
  {
    name: 'open',
    title: 'Open',
    description: 'Open a resource, file, chat, mini app surface, or settings anchor in the UI',
    scope: 'client',
    category: 'context',
  },
  // Info
  {
    name: 'help',
    title: 'Help',
    description: "List all slash commands by what they do — /help <command> for one's details",
    scope: 'server',
    category: 'info',
    args: HELP_ARGS,
  },
  {
    name: 'usage',
    aliases: ['cost'],
    title: 'Usage',
    description: 'Show token usage and estimated cost for this session',
    scope: 'server',
    category: 'info',
    argless: true,
  },
  {
    name: 'context',
    title: 'Context',
    description: 'Show how full this chat’s context window is',
    scope: 'client',
    category: 'info',
    argless: true,
  },
  {
    name: 'recap',
    title: 'Recap',
    description: 'Sum up this chat in one line, for when you come back to it',
    scope: 'server',
    category: 'info',
    argless: true,
  },
  // Memory & skills
  {
    name: 'memory',
    title: 'Memory',
    description: 'Show this project’s memory, or save a fact to it — /memory <fact>',
    scope: 'server',
    category: 'memory',
    args: MEMORY_ARGS,
  },
  {
    name: 'skills',
    aliases: ['skill'],
    title: 'Skills',
    description: 'List available skills — run any with /<name>',
    scope: 'server',
    category: 'memory',
    argless: true,
  },
  // Extensions
  {
    name: 'mcp',
    title: 'MCP',
    description: 'List MCP servers by source; reconnect, enable or disable one',
    scope: 'server',
    category: 'extensions',
    args: MCP_ARGS,
  },
  {
    name: 'plugin',
    title: 'Plugin',
    description: 'Manage Claude Code plugins and marketplaces',
    scope: 'server',
    category: 'extensions',
    args: PLUGIN_ARGS,
  },
  {
    name: 'mini-app',
    title: 'Mini app',
    description: 'List, switch on and off, remove and reload mini apps',
    scope: 'server',
    category: 'extensions',
    args: MINI_APP_ARGS,
  },
  {
    // Claude Code's spellings of `/plugin reload` (which reloads skills too); not in the menu.
    name: 'reload-plugins',
    aliases: ['reload-skills'],
    title: 'Reload plugins',
    description: 'Reload plugins and their skills — the same as /plugin reload',
    scope: 'server',
    category: 'extensions',
    argless: true,
    hidden: true,
  },
  ...CLAUDE_CODE_COMMANDS,
] as const

/** Names reserved by built-in commands (canonical + aliases): user skills cannot shadow them. */
export const BUILTIN_COMMAND_NAMES: ReadonlySet<string> = new Set(
  SLASH_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
)
