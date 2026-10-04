/**
 * Config-field materialization for the plugins subsystem.
 * Both turn a declared manifest option + the stored value into a UI field, masking
 * secrets identically. Each subsystem layers its own extra metadata (CC-spec
 * title/multiple/min/max for plugins; `enum` for agent providers) on top of this base.
 */

/** The subset of a declared config option this primitive needs to mask a value. */
export interface ConfigOptionBase {
  secret?: boolean
  default?: string | number | boolean
}

/** The masked base field shared by every config-field shape. */
export interface ConfigFieldBase {
  key: string
  value: string | number | boolean | null
  isSet: boolean
}

/**
 * Compute the secret-masked `value`/`isSet` for one declared option, given the
 * stored config blob. Secrets never expose their value (always null) and are
 * "set" only when an explicit value is stored. Non-secrets fall back to the
 * declared default and count as set when a default exists.
 */
export function configFieldBase(
  key: string,
  opt: ConfigOptionBase,
  stored: Record<string, string | number | boolean>,
): ConfigFieldBase {
  const has = Object.prototype.hasOwnProperty.call(stored, key)
  return {
    key,
    value: opt.secret ? null : has ? stored[key] : (opt.default ?? null),
    isSet: has || (!opt.secret && opt.default !== undefined),
  }
}

/**
 * Merge a `setConfig` value patch onto the existing stored config, honoring the
 * secret rule shared by both ext subsystems: a secret left BLANK ('') means
 * "keep the current value", not "clear it". Non-secret values (and non-empty
 * secrets) overwrite. Returns a fresh object — the caller persists it.
 */
export function mergeConfigValues(
  declared: Record<string, ConfigOptionBase>,
  existing: Record<string, string | number | boolean> | undefined,
  values: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return { ...existing, ...configPatchValues(declared, values) }
}

/**
 * Normalize one wire-level config patch before an atomic repository merge.
 * Secret blanks are omissions, not writes; all other primitive values retain
 * their exact type (including false, zero, and the non-secret empty string).
 */
export function configPatchValues(
  declared: Record<string, ConfigOptionBase>,
  values: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const patch: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(values)) {
    const opt = declared[key]
    if (opt?.secret && value === '') continue
    patch[key] = value
  }
  return patch
}
