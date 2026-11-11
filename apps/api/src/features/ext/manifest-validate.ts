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
