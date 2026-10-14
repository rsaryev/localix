/**
 * The scalar coercions every normalizer in `normalize-*.ts` builds on. Every venue input is
 * UNTRUSTED: a number may arrive as a string, a string may be empty, anything may be `null`.
 */

/** Coerce to a finite number, else undefined. Venues routinely return numeric strings. */
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
