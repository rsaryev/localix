/**
 * Config parsing for the plugins subsystem, whose DB
 * rows both store a JSON `config` blob. Coerces to a flat record of primitive
 * values, dropping anything non-primitive; malformed JSON yields an empty record.
 */
export function parseTypedConfig(raw: string): Record<string, string | number | boolean> {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}
