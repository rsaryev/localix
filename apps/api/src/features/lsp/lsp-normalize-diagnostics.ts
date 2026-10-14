import type {
  LspDiagnostic,
  LspRange,
  LspPosition,
  LspRelatedInformation,
} from './lsp-response-types'
import { uriToPath, toRange } from './lsp-normalize-values'

/**
 * Normalize a diagnostic's `relatedInformation[]`: keep only entries whose
 * `location.uri` resolves to a local file path and that carry a valid range +
 * message. Returns `undefined` (not `[]`) when there is nothing usable, so the
 * field stays absent on the wire for the common no-related-info case.
 */
export function normalizeRelatedInformation(raw: unknown): LspRelatedInformation[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: LspRelatedInformation[] = []
  for (const entry of raw) {
    const e = entry as { location?: { uri?: unknown; range?: unknown }; message?: unknown } | null
    if (!e || typeof e.message !== 'string') continue
    const file = uriToPath(e.location?.uri)
    const range = toRange(e.location?.range)
    if (!file || !range) continue
    out.push({ location: { file, range }, message: e.message })
  }
  return out.length > 0 ? out : undefined
}

/** The `DiagnosticTag`s the editor renders (Unnecessary, Deprecated); anything else is noise. */
function normalizeDiagnosticTags(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const tags = raw.filter((tag): tag is number => tag === 1 || tag === 2)
  return tags.length > 0 ? tags : undefined
}

/** Copy a diagnostic through, normalizing its `relatedInformation` (uri → path) and `tags`. */
export function normalizeDiagnostic(d: LspDiagnostic): LspDiagnostic {
  const { relatedInformation, tags, ...rest } = d as LspDiagnostic & {
    relatedInformation?: unknown
    tags?: unknown
  }
  // The common diagnostic carries neither — pass it through without copying.
  if (relatedInformation === undefined && tags === undefined) return d
  const related = normalizeRelatedInformation(relatedInformation)
  const known = normalizeDiagnosticTags(tags)
  return {
    ...rest,
    ...(related ? { relatedInformation: related } : {}),
    ...(known ? { tags: known } : {}),
  }
}

/** True when two LSP ranges overlap (touching endpoints count as overlapping). */
function rangesOverlap(a: LspRange, b: LspRange): boolean {
  const before = (p: LspPosition, q: LspPosition) =>
    p.line < q.line || (p.line === q.line && p.character < q.character)
  // No overlap iff a ends strictly before b starts, or b ends strictly before a starts.
  return !(before(a.end, b.start) || before(b.end, a.start))
}

/**
 * The diagnostics whose range overlaps `range` — the ones the editor is asking to
 * fix, passed as the `context.diagnostics` of a `textDocument/codeAction` request.
 * A diagnostic with a malformed range is treated as document-wide (kept).
 */
export function diagnosticsOverlappingRange(
  diags: LspDiagnostic[],
  range: LspRange,
): LspDiagnostic[] {
  return diags.filter((d) => {
    const dr = toRange(d.range)
    return dr ? rangesOverlap(dr, range) : true
  })
}
