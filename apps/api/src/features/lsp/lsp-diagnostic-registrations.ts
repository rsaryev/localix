/** Apply diagnostic-provider entries in wire order; unrelated capabilities are ignored. */
export function applyDiagnosticRegistrations<T extends { id: string; method: string }>(
  entries: T[] | undefined,
  apply: (entry: T) => void,
): null {
  for (const entry of entries ?? []) {
    if (entry.method !== 'textDocument/diagnostic') continue
    apply(entry)
  }
  return null
}
