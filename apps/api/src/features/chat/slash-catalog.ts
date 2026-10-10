// Browser-safe public surface for built-in slash commands. The declarative catalog
// owns names, categories and argument definitions; helpers below derive search and help.

import { levenshtein } from '../../lib/edit-distance'
import { SLASH_CATEGORIES, SLASH_COMMANDS, type SlashCommandSpec } from './slash-command-catalog'
import type { SlashArgOption, ArgCondition } from './slash-args'

export { SLASH_CATEGORIES, SLASH_COMMANDS, BUILTIN_COMMAND_NAMES } from './slash-command-catalog'
export type { SlashCategoryId, SlashCommandSpec } from './slash-command-catalog'

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
