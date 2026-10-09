import { dedupeDiagnostics, normalizeDiagnostic } from './lsp-protocol'
import type { LspDiagnostic } from './lsp-response-types'
import type { DiagnosticRequestResult } from './lsp-client-contract'

/** Merge diagnostic sources while the client retains ownership of their maps and publishing. */
export function createDiagnosticsSnapshot(
  pushDiagnostics: ReadonlyMap<string, LspDiagnostic[]>,
  pullDiagnostics: Map<string, LspDiagnostic[]>,
  flushDiagnostics: () => void,
) {
  // Merge the push (publishDiagnostics) and pull (textDocument/diagnostic) maps
  // into one per-file snapshot, deduping the union for each file.
  function buildDiagnosticsSnapshot(): Record<string, LspDiagnostic[]> {
    const snapshot: Record<string, LspDiagnostic[]> = {}
    for (const file of new Set([...pushDiagnostics.keys(), ...pullDiagnostics.keys()])) {
      // Normalize `relatedInformation` (uri → local path) here — the single choke
      // point every diagnostic passes through before reaching the wire / accessor.
      snapshot[file] = dedupeDiagnostics([
        ...(pushDiagnostics.get(file) ?? []),
        ...(pullDiagnostics.get(file) ?? []),
      ]).map(normalizeDiagnostic)
    }
    return snapshot
  }

  function mergePullResults(filePath: string, results: DiagnosticRequestResult[]) {
    const handled = results.some((result) => result.handled)
    const matched = results.some((result) => result.matched)
    if (!handled) return { handled: false, matched: false }

    const merged = new Map<string, LspDiagnostic[]>()
    for (const result of results) {
      for (const [target, items] of result.byFile.entries()) {
        merged.set(target, [...(merged.get(target) ?? []), ...items])
      }
    }

    if (matched && !merged.has(filePath)) merged.set(filePath, [])
    for (const [target, items] of merged.entries())
      pullDiagnostics.set(target, dedupeDiagnostics(items))
    flushDiagnostics()

    return { handled, matched }
  }

  return { buildDiagnosticsSnapshot, mergePullResults }
}
