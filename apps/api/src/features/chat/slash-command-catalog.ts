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

import { LOOP_ARGS, PLUGIN_ARGS } from './slash-catalog-arguments'
import type { SlashArgSpec } from './slash-args'
import { AGENTS_ARGS } from './slash-catalog-agents'

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
    description: 'Find, create and manage specialists and this chat’s participants',
    scope: 'server',
    category: 'config',
    args: AGENTS_ARGS,
  },
  {
    name: 'model',
    aliases: ['models'],
    title: 'Model',
    description: 'List models or switch the active model — /model <name>',
    scope: 'server',
    category: 'config',
  },
  // Context management
  {
    name: 'fork',
    title: 'Fork',
    description:
      'Duplicate this conversation into a new chat you can take in a different direction',
    scope: 'client',
    category: 'context',
    argless: true,
  },
  {
    name: 'open',
    title: 'Open',
    description: 'Open a resource, file, chat, plugin surface, or settings anchor in the UI',
    scope: 'client',
    category: 'context',
  },
  // Info
  {
    name: 'help',
    title: 'Help',
    description:
      "List all slash commands, grouped by what they do — /help <command> for one command's details",
    scope: 'server',
    category: 'info',
    argless: true,
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
  // Core owns control/state commands; task macros belong to extensions.
  // Memory & skills
  {
    name: 'memory',
    title: 'Memory',
    description: 'List saved memories, or save one — /memory <fact>',
    scope: 'server',
    category: 'memory',
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
    description: 'List configured MCP servers and their tools',
    scope: 'server',
    category: 'extensions',
    argless: true,
  },
  {
    name: 'plugin',
    title: 'Plugin',
    description: 'Manage plugins and marketplaces',
    scope: 'server',
    category: 'extensions',
    args: PLUGIN_ARGS,
  },
] as const

/**
 * Names reserved by built-in commands (canonical + aliases) — user skills cannot
 * shadow these. Derived from the catalog so it can never drift from the menus.
 */
export const BUILTIN_COMMAND_NAMES: ReadonlySet<string> = new Set(
  SLASH_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
)
