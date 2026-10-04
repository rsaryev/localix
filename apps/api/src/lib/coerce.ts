/** Coerce an unknown value to a string[]: keep only string elements, [] when it
 *  isn't an array. For parsing loosely-typed JSON config / manifest fields. */
export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}
