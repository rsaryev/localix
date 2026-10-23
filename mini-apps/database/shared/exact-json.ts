/** JSON has no integer wider than Number's exact range; keep those values as strings. */
export function exactJsonInteger(value: bigint): number | string {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : value.toString()
}

/** Replacer for JSON-shaped database values that may contain native bigint leaves. */
export function exactJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? exactJsonInteger(value) : value
}

export function stringifyJsonExact(value: unknown): string | undefined {
  return JSON.stringify(value, exactJsonReplacer)
}
