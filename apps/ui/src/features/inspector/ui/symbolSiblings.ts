import type { LspDocumentSymbol } from '@/shared/api/contracts'

/**
 * The sibling symbols of the breadcrumb crumb at `index` — i.e. every symbol that
 * shares its parent (the breadcrumb dropdown lists the peers you can jump to
 * at that level). `symbolPath` is the enclosing chain outermost→innermost; the
 * crumb's parent is the previous entry in that chain (none for a top-level crumb).
 *
 * Siblings are all `docSymbols` at the crumb's own nesting depth, constrained to
 * the parent's span when there is one, returned in document (line) order.
 */
export function symbolSiblings(
  docSymbols: LspDocumentSymbol[],
  symbolPath: LspDocumentSymbol[],
  index: number,
): LspDocumentSymbol[] {
  const crumb = symbolPath[index]
  if (!crumb) return []
  const parent = index > 0 ? symbolPath[index - 1] : undefined
  return docSymbols
    .filter(
      (s) =>
        s.depth === crumb.depth &&
        (!parent || (s.line >= parent.line && s.endLine <= parent.endLine)),
    )
    .sort((a, b) => a.line - b.line)
}
