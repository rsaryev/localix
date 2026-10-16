/**
 * Shared pure validation primitives used by both `plugins/validate.ts` and
 * the plugin validator. Node-only (no chat/UI imports). Each helper is a
 * faithful extract of logic that was duplicated — same edge cases, same return shapes.
 *
 * Extracted in Phase 0.6 of the plugins-subsystem unification.
 */

import { DECLARABLE_REASONING_EFFORTS, resolveDeclaredReasoningEffort } from '../../db/types'
import { levenshtein } from '../../lib/edit-distance'

// ---------------------------------------------------------------------------
// Edit distance
// ---------------------------------------------------------------------------

/**
 * Edit distance for typo-suggestion warnings on unrecognized manifest fields — only `<= 2` is a
 * suggestion, so it is the shared bounded Levenshtein with that bound: exact up to 2, above 2
 * otherwise (no full matrix for an unrelated field name).
 */
export function editDistance(a: string, b: string): number {
  return levenshtein(a, b, 2)
}

// ---------------------------------------------------------------------------
// API version compatibility
// ---------------------------------------------------------------------------

/**
 * Check a manifest's `apiVersion` against the host's supported version.
 * - Missing → push a warning (nudge to add it; assumed compatible).
 * - Newer than host → push an error (host can't satisfy the contract).
 *
 * @param kind   Human-readable noun for the manifest type ("Plugin" | "Provider" etc.)
 * @param hostVersion  The version constant this host implements.
 * @param declaredApi  The raw `apiVersion` from the manifest (may be undefined).
 * @param errors  Array to push errors into (mutated in place).
 * @param warnings  Array to push warnings into (mutated in place).
 */
export function checkApiVersion(
  kind: string,
  hostVersion: number,
  declaredApi: number | undefined,
  errors: string[],
  warnings: string[],
): void {
  const tooNew = apiVersionTooNew(kind, hostVersion, declaredApi)
  if (declaredApi === undefined) {
    warnings.push(
      `Manifest declares no apiVersion — assuming ${hostVersion}. Add "apiVersion": ${hostVersion}.`,
    )
  } else if (tooNew) {
    errors.push(tooNew)
  }
}

/**
 * Why a manifest cannot be satisfied by this host, or null when it can — the single source of the
 * incompatibility MESSAGE, so the diagnostics text and the load gate that refuses the plugin cannot
 * drift apart. {@link checkApiVersion} reports it; `pluginLoadBlockReason` enforces it.
 */
export function apiVersionTooNew(
  kind: string,
  hostVersion: number,
  declaredApi: number | undefined,
): string | null {
  if (declaredApi === undefined || declaredApi <= hostVersion) return null
  return `${kind} targets API v${declaredApi}, but this host implements v${hostVersion}. Update the host.`
}

// ---------------------------------------------------------------------------
// Required-config presence check
// ---------------------------------------------------------------------------

/**
 * Return true when a required config key has no usable value (undefined or empty
 * string). Both plugin and provider validators use the same condition.
 */
export function isRequiredConfigMissing(
  opt: { required?: boolean },
  value: string | number | boolean | undefined,
): boolean {
  return !!(opt.required && (value === undefined || value === ''))
}

// ---------------------------------------------------------------------------
// Path safety predicate
// ---------------------------------------------------------------------------

/**
 * Return true when `path` contains `..` (traversal) OR is an absolute path
 * (Unix `/`, Windows `C:\`, or UNC `\\`). Used as a pure predicate; the caller
 * composes the warning message with context.
 */
export function isUnsafeRelPath(path: string): boolean {
  return (
    path.includes('..') ||
    path.startsWith('/') ||
    /^[A-Za-z]:\\/.test(path) ||
    path.startsWith('\\\\')
  )
}

// ---------------------------------------------------------------------------
// Kebab-case name predicate
// ---------------------------------------------------------------------------

/**
 * Return true when `name` is strict kebab-case (lowercase letters, digits,
 * and hyphens only, no leading/trailing hyphen). The Claude.ai marketplace
 * sync requires this; our schema accepts underscores/camelCase but warns.
 */
export function isKebabCase(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)
}

// ---------------------------------------------------------------------------
// Reasoning-effort regex
// ---------------------------------------------------------------------------

/**
 * Is this a reasoning-effort level a declaration may name?
 *
 * DERIVED, never hand-listed. This used to be a literal regex, and a second copy of it lived in
 * `agent-core/skill-validate.ts` with the same values plus three hand-written "valid values: …"
 * messages. All of them had drifted from the real vocabulary in BOTH directions: they rejected
 * `minimal` (a level the runtime accepts and the model picker offers) and accepted `xhigh`
 * (which the column cannot hold, so it needed normalizing rather than waving through).
 */
export function isDeclarableEffort(value: string): boolean {
  return resolveDeclaredReasoningEffort(value) !== undefined
}

/** The values to name in a warning, so the message cannot drift from the check. */
export const DECLARABLE_EFFORTS_TEXT = DECLARABLE_REASONING_EFFORTS.join(', ')

// ---------------------------------------------------------------------------
// Undeclared template-token collector
// ---------------------------------------------------------------------------

/**
 * Extract every `${KEY}` or `${user_config.KEY}` token from `text` and return
 * the bare key names (i.e. after stripping the `user_config.` prefix).
 *
 * @param text  A string that may contain `${…}` token references.
 * @returns A Set of bare key strings found in the text.
 */
export function collectTextTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  for (const m of text.matchAll(/\$\{([\w.]+)\}/g)) {
    const raw = m[1]
    tokens.add(raw.startsWith('user_config.') ? raw.slice('user_config.'.length) : raw)
  }
  return tokens
}
