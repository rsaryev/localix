/**
 * Lenient text coercion for CLI and API JSON — the Docker and Kubernetes parsers alike. A missing
 * value is empty text, a scalar its own spelling, anything else its JSON; never a throw.
 */
export const str = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return ''
  }
}
