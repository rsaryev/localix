/**
 * Shared pure validation primitives used by both `plugins/validate.ts` and
 * the plugin validator. Node-only (no chat/UI imports). Each helper is a
 * faithful extract of logic that was duplicated — same edge cases, same return shapes.
 *
 * Extracted in Phase 0.6 of the plugins-subsystem unification.
 */

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
