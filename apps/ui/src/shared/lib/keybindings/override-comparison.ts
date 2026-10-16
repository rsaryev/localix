import { canonicalizeChord, type BindingOverrides, type Chord } from '@localixai/kit/keybindings'

/** Canonicalize an override map for order-independent comparison. */
function normalize(overrides: BindingOverrides | undefined): Record<string, Chord> {
  const out: Record<string, Chord> = {}
  if (!overrides) return out
  for (const key of Object.keys(overrides)) {
    out[key] = canonicalizeChord(overrides[key])
  }
  return out
}

export function sameOverrides(
  a: BindingOverrides | undefined,
  b: BindingOverrides | undefined,
): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  const ka = Object.keys(na)
  const kb = Object.keys(nb)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(nb, k) && na[k] === nb[k])
}
