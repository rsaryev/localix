/**
 * Shared frontmatter-value coercion primitives for the plugins + agents
 * discovery loaders (both parse Claude-Code-style markdown frontmatter and
 * previously carried their own near-identical boolean coercers). Keeping the
 * rule in ONE place means `true`/`yes`/`1` (and their negatives) are read the
 * same way everywhere a CC scalar becomes a boolean.
 */

import { scalarField } from '../agent-core/skill-discovery'

/**
 * Read a frontmatter field as a trimmed non-empty string, or undefined. Folds
 * the loaders' repeated `scalarField(x)?.trim() || undefined` idiom: scalarizes
 * a scalar-or-array value, trims it, and collapses the empty string to undefined.
 */
export function trimmedFrontmatterField(value: string | string[] | undefined): string | undefined {
  return scalarField(value)?.trim() || undefined
}

/**
 * Coerce an already-scalarized YAML frontmatter value to a TRI-STATE boolean:
 * `true`/`yes`/`1` → true, `false`/`no`/`0` → false, anything else (incl.
 * `undefined`) → undefined. Case- and whitespace-insensitive. Use when the
 * "unset" case must stay distinguishable from an explicit `false`.
 */
export function coerceFrontmatterBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === 'yes' || v === '1') return true
  if (v === 'false' || v === 'no' || v === '0') return false
  return undefined
}
