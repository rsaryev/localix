/**
 * CC model-alias resolution — the single point that turns an agent/skill `model:`
 * value into a concrete catalog model id.
 *
 * Claude Code sub-agent and skill frontmatter accept model ALIASES (`inherit`,
 * `sonnet`, `opus`, `haiku`, plus Localix's `fable`), not only concrete catalog
 * ids. Stored verbatim, an alias would be passed straight through as a literal
 * `modelId` (there is no model literally named "sonnet"), so a delegated or forked
 * child would start on a non-existent model. Every place an agent or
 * skill `model:` reaches session creation routes through `resolveModelAlias`.
 *
 * Pure module — no fs, no chat imports (agent-core stays agnostic).
 */

/** Alias FAMILIES recognized in CC / Localix frontmatter. Lowercase. */
export const MODEL_ALIAS_FAMILIES = ['sonnet', 'opus', 'haiku', 'fable'] as const
export type ModelAliasFamily = (typeof MODEL_ALIAS_FAMILIES)[number]

/** `inherit` / empty → "use the parent/session model". */
function isInherit(value: string | undefined): boolean {
  return !value || value.trim().toLowerCase() === 'inherit'
}

/**
 * Does resolving this value REQUIRE the catalog? True only for a bare family alias — `inherit`,
 * an empty value and an already-concrete id all resolve without it. Callers use this to skip a
 * catalog read on the common paths (`resolveModelAlias` still degrades safely without one, which
 * is exactly the silent no-op this exists to avoid).
 */
export function isModelAliasFamily(value: string | undefined): boolean {
  return !isInherit(value) && familyOf(value!) !== undefined
}

/** The alias family a value names EXACTLY (`sonnet`), or undefined (a concrete id). */
function familyOf(value: string): ModelAliasFamily | undefined {
  const v = value.trim().toLowerCase()
  return (MODEL_ALIAS_FAMILIES as readonly string[]).includes(v)
    ? (v as ModelAliasFamily)
    : undefined
}

/** Compare two ids by their numeric groups (then lexically) — larger numbers = newer. */
function compareVersionish(a: string, b: string): number {
  const na = a.match(/\d+/g)?.map(Number) ?? []
  const nb = b.match(/\d+/g)?.map(Number) ?? []
  const len = Math.max(na.length, nb.length)
  for (let i = 0; i < len; i++) {
    const d = (na[i] ?? -1) - (nb[i] ?? -1)
    if (d !== 0) return d
  }
  return a.localeCompare(b)
}

/**
 * Pick the best available model id for an alias FAMILY: among catalog ids whose id
 * contains the family word (case-insensitive), prefer the "newest" — the one whose
 * numeric version groups sort highest (e.g. `claude-sonnet-4-5` over
 * `claude-3-5-sonnet`). Returns undefined when no catalog id matches the family.
 */
export function bestModelForFamily(
  family: ModelAliasFamily,
  availableModelIds: readonly string[],
): string | undefined {
  const matches = availableModelIds.filter((id) => id.toLowerCase().includes(family))
  if (matches.length === 0) return undefined
  return matches.slice().sort((a, b) => compareVersionish(b, a))[0]
}

/**
 * Resolve an agent/skill `model:` value to a concrete model id.
 *  - `inherit` / undefined / empty → the parent/session model.
 *  - a known alias family (`sonnet`/`opus`/`haiku`/`fable`) → the best matching id
 *    from `availableModelIds`, else the parent model (never the bare alias word).
 *  - anything else (already a concrete id) → returned verbatim.
 * Returns undefined only when it resolves to "inherit" and no parent model is known.
 */
export function resolveModelAlias(
  alias: string | undefined,
  parentModelId: string | undefined,
  availableModelIds?: readonly string[],
): string | undefined {
  if (isInherit(alias)) return parentModelId
  const family = familyOf(alias!)
  if (!family) return alias!.trim() // concrete model id — pass through
  const best = availableModelIds?.length ? bestModelForFamily(family, availableModelIds) : undefined
  return best ?? parentModelId
}
