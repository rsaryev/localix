import { scalarField } from '../agent-core/skill-frontmatter'
/**
 * Shared frontmatter-value coercion primitives for the plugins + agents
 * discovery loaders (both parse Claude-Code-style markdown frontmatter and
 * previously carried their own near-identical boolean coercers). Keeping the
 * rule in ONE place means `true`/`yes`/`1` (and their negatives) are read the
 * same way everywhere a CC scalar becomes a boolean.
 */

/**
 * Read a frontmatter field as a trimmed non-empty string, or undefined. Folds
 * the loaders' repeated `scalarField(x)?.trim() || undefined` idiom: scalarizes
 * a scalar-or-array value, trims it, and collapses the empty string to undefined.
 */
export function trimmedFrontmatterField(value: string | string[] | undefined): string | undefined {
  return scalarField(value)?.trim() || undefined
}
