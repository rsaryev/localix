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

import { LOOP_ARGS, REASONING_ARGS, PLUGIN_ARGS } from './slash-catalog-arguments'

import { levenshtein } from '../../lib/edit-distance'

import type { SlashArgSpec, SlashArgOption, ArgCondition } from './slash-args'

// Re-export the argument-spec core so consumers get everything from one subpath.
export type {
  SlashArgSpec,
  SlashArgOption,
  ArgCondition,
  ParsedCommandArgs,
  ParsedArgChip,
} from './slash-args'
export {
  parseCommandArgs,
  filterArgOptions,
  argConditionMet,
  INTERVAL_TOKEN_RE,
} from './slash-args'

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
    name: 'model',
    aliases: ['models'],
    title: 'Model',
    description: 'List models or switch the active model — /model <name>',
    scope: 'server',
    category: 'config',
  },
  {
    name: 'reasoning',
    title: 'Reasoning',
    description: 'Set reasoning effort — /reasoning [@handle] <effort> [task]',
    scope: 'server',
    category: 'config',
    hidden: true,
    args: REASONING_ARGS,
  },
  // Context management
  {
    name: 'clear',
    title: 'Clear context',
    description: 'Start fresh — messages stay visible but the agent forgets prior context',
    scope: 'server',
    category: 'context',
    argless: true,
  },
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

/** A compact usage signature for a command — `/plugin <list|create|…> [target]`. Choice
 *  args render their option set (capped); text args render `[name]`. Drives the
 *  scannable `/help` reference so every command shows its argument shape. */
export function commandUsage(c: SlashCommandSpec): string {
  const parts = (c.args ?? []).map((a) => {
    // A DYNAMIC arg has no static options to print — its list is fetched — so it renders as a
    // placeholder like a text arg does, which is also what it looks like to the person typing.
    const options = a.type === 'choice' || a.type === 'interval' ? (a.options ?? []) : []
    if (options.length > 0) {
      const opts = options.map((o) => o.value)
      const shown = opts.length > 6 ? `${opts.slice(0, 6).join('|')}|…` : opts.join('|')
      return `<${shown}>`
    }
    return `[${a.name}]`
  })
  return [`/${c.name}`, ...parts].join(' ')
}

/** Human label for a command's category (e.g. `info` → `Info`). */
export function commandCategoryLabel(c: SlashCommandSpec): string {
  return SLASH_CATEGORIES.find((cat) => cat.id === c.category)?.label ?? c.category
}

/** Resolve a typed command name to its canonical spec, tolerating a leading slash,
 *  surrounding whitespace, and any case, and folding aliases (`cost` → `usage`).
 *  Returns undefined for an unknown or empty name. */
export function resolveCommandSpec(
  name: string,
  commands: readonly SlashCommandSpec[] = SLASH_COMMANDS,
): SlashCommandSpec | undefined {
  const q = name.trim().replace(/^\/+/, '').toLowerCase()
  if (!q) return undefined
  return commands.find((c) => c.name === q || (c.aliases ?? []).includes(q))
}

/** Nearest known commands to a mistyped name, for a "did you mean" hint. Ranks
 *  prefix/substring matches first, then closest edit distance; skips hidden commands
 *  and caps the result. Names+aliases are searched but only canonical specs returned. */
export function suggestCommands(
  name: string,
  opts?: { limit?: number; commands?: readonly SlashCommandSpec[] },
): SlashCommandSpec[] {
  const q = name.trim().replace(/^\/+/, '').toLowerCase()
  if (!q) return []
  const commands = (opts?.commands ?? SLASH_COMMANDS).filter((c) => !c.hidden)
  const scored = commands
    .flatMap((c) => {
      const names = [c.name, ...(c.aliases ?? [])]
      const prefix = names.some((n) => n.startsWith(q) || q.startsWith(n))
      const substr = names.some((n) => n.includes(q) || q.includes(n))
      const dist = Math.min(...names.map((n) => levenshtein(q, n, 4)))
      const rank = prefix ? 0 : substr ? 1 : 2
      if (rank >= 2 && dist > 3) return []
      return [{ c, rank, dist }]
    })
    .sort((a, b) => a.rank - b.rank || a.dist - b.dist || a.c.name.localeCompare(b.c.name))
  return scored.slice(0, opts?.limit ?? 3).map((s) => s.c)
}

/** One argument's help detail: its display signature plus the option set / hint the
 *  arg-menu would offer. Presentation-neutral so each surface renders it its own way. */
export interface CommandArgDetail {
  name: string
  /** `<ask|edit|…>` for a closed set, `[name]` for free text. */
  signature: string
  placeholder?: string
  /** Full option set for a `choice`/`interval` arg (empty for free text). */
  options: SlashArgOption[]
  /** When this arg only applies after an earlier choice (e.g. `/plugin marketplace`). */
  when?: ArgCondition
}

/** A command's full help detail — the single structured source every `/help <cmd>`
 *  renderer formats (web markdown today). */
export interface CommandDetail {
  name: string
  title: string
  usage: string
  description: string
  categoryLabel: string
  aliases: string[]
  argless: boolean
  args: CommandArgDetail[]
}

/** Build the structured {@link CommandDetail} for a command — resolved usage,
 *  category, aliases, and per-argument option sets. Pure; no session state. */
export function describeCommand(c: SlashCommandSpec): CommandDetail {
  return {
    name: c.name,
    title: c.title,
    usage: commandUsage(c),
    description: c.description,
    categoryLabel: commandCategoryLabel(c),
    aliases: c.aliases ?? [],
    argless: c.argless ?? false,
    args: (c.args ?? []).map((a) => {
      // See `commandUsage`: no static options is a live list, not an empty choice.
      const options = a.type === 'choice' || a.type === 'interval' ? (a.options ?? []) : []
      return {
        name: a.name,
        signature: options.length ? `<${options.map((o) => o.value).join('|')}>` : `[${a.name}]`,
        placeholder: a.placeholder,
        options,
        when: a.when,
      }
    }),
  }
}

/**
 * Groups the catalog into its ordered {@link SLASH_CATEGORIES} sections, dropping
 * empty groups (and hidden commands unless `includeHidden`). The single grouping
 * used by every surface's `/help`, so no two of them group commands differently.
 */
export function groupCommandsByCategory(
  commands: readonly SlashCommandSpec[] = SLASH_COMMANDS,
  opts?: { includeHidden?: boolean },
): { category: (typeof SLASH_CATEGORIES)[number]; commands: SlashCommandSpec[] }[] {
  const visible = commands.filter((c) => opts?.includeHidden || !c.hidden)
  return SLASH_CATEGORIES.flatMap((category) => {
    const inCategory = visible.filter((c) => c.category === category.id)
    return inCategory.length > 0 ? [{ category, commands: inCategory }] : []
  })
}
