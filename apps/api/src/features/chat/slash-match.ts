// PURE tier-ranked matcher for a slash-command menu, owned in one place so every
// surface that ranks the palette ranks it the same way and cannot drift. Generic over
// the minimal `{ name, description }` shape.
//
// Leaf module (no server graph; its one import is the shared positional matcher
// `@localixai/search/positions`) — a sibling of `slash-catalog` / `mode-catalog`,
// consumable from any surface via the `@localixai/api/slash-match` subpath without
// pulling in server code.
//
// Tiers, best (lowest) first — mirrors the web composer's `slashCommandMatch`:
//   0 exact name · 1 name prefix · 2 name/description substring · 3 fuzzy subsequence.
// The name-based prefix tier works at any query length; the weaker substring +
// subsequence tiers are gated at 2+ chars so a single letter never floods the menu
// with loosely-related hits — a terminal-palette convention this matcher keeps as its
// DEFAULT.
//
// `ScoreSlashMatchOptions` is how a surface opts out of that default. The web composer
// (`apps/ui`) is the only caller today: it passes `{ minWeakLen: 1,
// descriptionPrefixTier: true }` so weak tiers engage at a single character AND a
// description PREFIX ranks as tier 1 (Prefix), matching the composer menu's original
// hand-rolled matcher. The knobs exist because the defaults encode one surface's
// convention rather than a universal rule — not because a second caller is pending.

import { positionalMatch, type PositionalMatch } from '@localixai/search/positions'

/** Match strength, best (lowest) first. */
export const SlashMatchTier = {
  ExactName: 0,
  Prefix: 1,
  Substring: 2,
  Subsequence: 3,
} as const
export type SlashMatchTier = (typeof SlashMatchTier)[keyof typeof SlashMatchTier]

export interface SlashMatchTarget {
  /** Command trigger, WITH or WITHOUT a leading `/` (a single leading slash is stripped). */
  name: string
  description: string
}

export interface SlashMatchResult {
  tier: SlashMatchTier
  /** Which field produced the (strongest) match — the field to highlight against. */
  field: 'name' | 'description'
  /** Matched character indices in the matched field AS GIVEN (a leading `/` included), the
   *  characters a menu highlights. Empty for the bare-`/` show-all query. */
  positions: Set<number>
}

export interface ScoreSlashMatchOptions {
  /**
   * Minimum query length before the weaker substring/subsequence tiers engage.
   * Default 2 — the terminal palette's convention, where a single letter should
   * only prefix-match (never flood the menu with loose subsequence hits). Pass 1
   * to let the weak tiers match at any length (the web composer's behaviour).
   */
  minWeakLen?: number
  /**
   * When true, a DESCRIPTION prefix ranks as `Prefix` (tier 1), un-gated by length,
   * checked right after the name-prefix tier. Default false — the description
   * otherwise participates only through the weak substring/subsequence tiers. The
   * web composer enables this to preserve its original title-prefix ranking.
   */
  descriptionPrefixTier?: boolean
}

/** A single leading `/` is not part of the fuzzy-matchable token on either side. */
function stripSlash(s: string): string {
  return s.startsWith('/') ? s.slice(1) : s
}

function shifted(positions: Set<number>, by: number): Set<number> {
  return by === 0 ? positions : new Set(Array.from(positions, (i) => i + by))
}

/**
 * Score one command against `query`. Returns the strongest tier + the field that
 * produced it (with matched positions), or `null` when nothing matches. `query` and
 * `target.name` may each carry a leading `/`; a single one is stripped before matching
 * so callers can pass the raw composer value (`/mo`) or a bare token (`mo`).
 */
export function scoreSlashMatch(
  query: string,
  target: SlashMatchTarget,
  opts?: ScoreSlashMatchOptions,
): SlashMatchResult | null {
  const minWeakLen = opts?.minWeakLen ?? 2
  const q = stripSlash(query.trim())
  // Positions index the field AS GIVEN, so a `/`-prefixed name shifts them past its slash.
  const nameOffset = target.name.startsWith('/') ? 1 : 0
  // The empty `/`-only query prefixes every command — the "show all" of a bare slash.
  if (!q) return { tier: SlashMatchTier.Prefix, field: 'name', positions: new Set() }

  // One positional matcher decides both the tier and the characters a menu highlights.
  const onName = positionalMatch(q, stripSlash(target.name))
  const onDesc = positionalMatch(q, target.description)
  const hit = (
    tier: SlashMatchTier,
    field: SlashMatchResult['field'],
    match: PositionalMatch,
  ): SlashMatchResult => ({
    tier,
    field,
    positions: field === 'name' ? shifted(match.positions, nameOffset) : match.positions,
  })

  if (onName?.kind === 'exact') return hit(SlashMatchTier.ExactName, 'name', onName)
  // Name prefix — works at any length.
  if (onName?.kind === 'prefix') return hit(SlashMatchTier.Prefix, 'name', onName)
  // Optional description-prefix tier (web composer parity), un-gated by length.
  const descIsPrefix = onDesc?.kind === 'exact' || onDesc?.kind === 'prefix'
  if (opts?.descriptionPrefixTier && descIsPrefix)
    return hit(SlashMatchTier.Prefix, 'description', onDesc)

  // Weaker tiers only once there's a real (`minWeakLen`+ char) token to match on.
  if (q.length < minWeakLen) return null
  if (onName?.kind === 'substring') return hit(SlashMatchTier.Substring, 'name', onName)
  if (onDesc && onDesc.kind !== 'subsequence')
    return hit(SlashMatchTier.Substring, 'description', onDesc)
  if (onName) return hit(SlashMatchTier.Subsequence, 'name', onName)
  if (onDesc) return hit(SlashMatchTier.Subsequence, 'description', onDesc)
  return null
}
