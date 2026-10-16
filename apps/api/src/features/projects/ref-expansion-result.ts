import type { ContextRef, ContextRefExpansion } from './contracts'

export function fail(ref: ContextRef, error: string): ContextRefExpansion {
  return { raw: ref.raw, ok: false, error, chars: 0 }
}

export function succeed(
  ref: ContextRef,
  content: string,
  extra?: Partial<ContextRefExpansion>,
): ContextRefExpansion {
  return { raw: ref.raw, ok: true, content, chars: content.length, ...extra }
}
