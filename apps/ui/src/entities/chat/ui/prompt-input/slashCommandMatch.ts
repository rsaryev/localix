/**
 * slashCommandMatch — PURE filtering + tiered ranking for the composer slash-menu.
 *
 * This is a thin adapter over the SHARED leaf `@localixai/api/slash-match`
 * (`scoreSlashMatch`), so the web composer and the terminal palette rank the slash
 * menu with ONE source of truth and never drift. The leaf models the tiers
 * (exact / prefix / substring / fuzzy subsequence); this file only maps the web's
 * `{trigger, title}` command shape onto the leaf's `{name, description}` and passes
 * the composer's two behaviour knobs:
 *   - `minWeakLen: 1` — the weak (substring/subsequence) tiers match at ANY query
 *     length here (the leaf's default gates them at 2+; the composer never did).
 *   - `descriptionPrefixTier: true` — a title prefix ranks as Prefix (tier 1),
 *     matching the composer's original hand-rolled matcher.
 *
 * Non-regression guard: everything the old substring filter matched still matches
 * (substring is tier 2, always ahead of a subsequence-only tier-3 hit), and an
 * empty query returns the full list in importance order.
 */
import type { SlashCommand } from './SlashCommandMenu'
import { scoreSlashMatch } from '@localixai/api/slash-match'

/** Match strength, best (lowest) first. Values line up with the shared leaf's tiers. */
export const SlashMatchTier = {
  ExactTrigger: 0,
  Prefix: 1,
  Substring: 2,
  Subsequence: 3,
} as const
export type SlashMatchTier = (typeof SlashMatchTier)[keyof typeof SlashMatchTier]

export interface SlashMatch {
  tier: SlashMatchTier
  /** Which field drove the (strongest) match — the field to highlight against. */
  field: 'trigger' | 'title'
  /** The matched indices in that field, as the leaf ranked them — what the menu highlights. */
  positions: Set<number>
}

/** A command its plugin's manifest marks `featured` is shown first, under "Suggested". */
export const isFeaturedSlashCommand = (cmd: SlashCommand): boolean => cmd.featured === true

/**
 * Group ordering used by SlashCommandMenu (Suggested → Commands → Plugins → Skills). Used as
 * the WITHIN-tier tiebreak so, at equal match strength, the featured command leads, built-ins
 * stay ahead of plugins, and plugins ahead of skills.
 */
export function commandGroupRank(cmd: SlashCommand): number {
  if (isFeaturedSlashCommand(cmd)) return -1
  if (cmd.kind === 'skill') return 2
  if (cmd.id.startsWith('plugin:')) return 1
  return 0
}

/**
 * Built-in sections by how often a chat reaches for them: choosing the model and the team, then
 * what the agent reads, then automation, memory, extensions and reference.
 */
const CATEGORY_IMPORTANCE: readonly string[] = [
  'config',
  'context',
  'autonomous',
  'memory',
  'extensions',
  'info',
]

const categoryRank = (cmd: SlashCommand): number => {
  const rank = cmd.category ? CATEGORY_IMPORTANCE.indexOf(cmd.category) : -1
  return rank < 0 ? CATEGORY_IMPORTANCE.length : rank
}

/** Importance order: group first, then a built-in's section; stable within a section. */
const byImportance = (a: SlashCommand, b: SlashCommand): number =>
  commandGroupRank(a) - commandGroupRank(b) || categoryRank(a) - categoryRank(b)

/**
 * Score one command against a NON-EMPTY, already-lowercased query. Returns the
 * strongest tier + the field that produced it, or `null` when the command matches
 * neither the trigger nor the title by any strategy. Delegates to the shared leaf;
 * the leaf's `name`/`description` fields map back to the composer's `trigger`/`title`.
 */
export function matchSlashCommand(query: string, cmd: SlashCommand): SlashMatch | null {
  const result = scoreSlashMatch(
    query,
    { name: cmd.trigger, description: cmd.title },
    { minWeakLen: 1, descriptionPrefixTier: true },
  )
  if (!result) return null
  return {
    tier: result.tier as SlashMatchTier,
    field: result.field === 'name' ? 'trigger' : 'title',
    positions: result.positions,
  }
}

/**
 * Filter + rank the command list for the given query.
 *
 * - Empty query → the full list by importance: featured commands first, then the built-in sections in
 *   {@link CATEGORY_IMPORTANCE} order, then plugins, then skills.
 * - Otherwise → matches only, sorted by (tier, importance, original position).
 *   Tier is primary so an exact/prefix hit floats above a substring hit which
 *   floats above a fuzzy-only hit; group rank + stable index preserve the old
 *   ordering within a tier.
 */
export function filterAndRankSlashCommands(
  query: string,
  commands: SlashCommand[],
): SlashCommand[] {
  if (query === '') {
    return commands
      .map((cmd, i) => ({ cmd, i }))
      .sort((a, b) => byImportance(a.cmd, b.cmd) || a.i - b.i)
      .map((e) => e.cmd)
  }

  return commands
    .map((cmd, i) => ({ cmd, i, match: matchSlashCommand(query, cmd) }))
    .filter((e): e is { cmd: SlashCommand; i: number; match: SlashMatch } => e.match !== null)
    .sort((a, b) => a.match.tier - b.match.tier || byImportance(a.cmd, b.cmd) || a.i - b.i)
    .map((e) => e.cmd)
}
