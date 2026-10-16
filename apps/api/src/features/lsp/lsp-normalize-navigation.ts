import type {
  LspLocation,
  LspCallHierarchyItem,
  LspWorkspaceSymbol,
  LspDocumentSymbol,
} from './lsp-response-types'
import { toRange } from './lsp-normalize-values'

/** Normalize a `textDocument/definition` or `references` result (Location | Location[] | LocationLink[]). */
export function normalizeLocations(res: unknown): LspLocation[] {
  if (!res) return []
  const arr = Array.isArray(res) ? res : [res]
  const out: LspLocation[] = []
  for (const raw of arr) {
    const l = raw as {
      uri?: string
      range?: LspLocation['range']
      targetUri?: string
      targetSelectionRange?: LspLocation['range']
      targetRange?: LspLocation['range']
    }
    const uri = l.targetUri ?? l.uri
    const range = l.targetSelectionRange ?? l.targetRange ?? l.range
    if (uri && range) out.push({ uri, range })
  }
  return out
}

/**
 * Normalize a `textDocument/prepareCallHierarchy` response (`CallHierarchyItem[]`
 * or null) — kept raw (uri + range preserved) so the exact server item can be
 * echoed back to `callHierarchy/incomingCalls` (its `data` is round-tripped per
 * spec). Only entries carrying a usable `uri` + `range` survive.
 */
export function normalizeCallHierarchyItems(res: unknown): LspCallHierarchyItem[] {
  if (!res) return []
  const arr = Array.isArray(res) ? res : [res]
  const out: LspCallHierarchyItem[] = []
  for (const raw of arr) {
    const it = raw as { uri?: unknown; range?: unknown } | null
    if (!it || typeof it.uri !== 'string' || !toRange(it.range)) continue
    out.push(raw as LspCallHierarchyItem)
  }
  return out
}

/**
 * Normalize a `callHierarchy/incomingCalls` response (`CallHierarchyIncomingCall[]`,
 * each `{ from: CallHierarchyItem, fromRanges: Range[] }`) into a flat list of CALL
 * SITE locations — one per `fromRange`, at the caller's `from.uri`. This lets
 * "who calls this" reuse the same location shaping references uses (grouped by
 * caller file, previewing the call-site line). Falls back to the caller's
 * `selectionRange`/`range` when the server omits `fromRanges`.
 */
export function normalizeIncomingCallSites(res: unknown): LspLocation[] {
  if (!Array.isArray(res)) return []
  const out: LspLocation[] = []
  for (const raw of res) {
    const call = raw as {
      from?: { uri?: unknown; range?: unknown; selectionRange?: unknown }
      fromRanges?: unknown
    }
    const uri = call.from?.uri
    if (typeof uri !== 'string') continue
    const ranges = Array.isArray(call.fromRanges) ? call.fromRanges : []
    const sites = ranges.length > 0 ? ranges : [call.from?.selectionRange ?? call.from?.range]
    for (const r of sites) {
      const range = toRange(r)
      if (range) out.push({ uri, range })
    }
  }
  return out
}

/**
 * Normalize a `callHierarchy/outgoingCalls` response (`CallHierarchyOutgoingCall[]`,
 * each `{ to: CallHierarchyItem, fromRanges: Range[] }`) into a flat list of CALLEE
 * locations — one per outgoing call, at the callee's `to.uri` + `to.selectionRange`
 * (its name). This is the symmetric opposite of incoming calls: the callee's own
 * declaration is what "who does this call" wants to surface, so we group by CALLEE
 * file (not the call sites in the caller, which `fromRanges` describe). Falls back
 * to `to.range` when the server omits `selectionRange`.
 */
export function normalizeOutgoingCallSites(res: unknown): LspLocation[] {
  if (!Array.isArray(res)) return []
  const out: LspLocation[] = []
  for (const raw of res) {
    const call = raw as { to?: { uri?: unknown; range?: unknown; selectionRange?: unknown } }
    const uri = call.to?.uri
    if (typeof uri !== 'string') continue
    const range = toRange(call.to?.selectionRange ?? call.to?.range)
    if (range) out.push({ uri, range })
  }
  return out
}

/**
 * Normalize an LSP documentSymbol response — either hierarchical `DocumentSymbol[]`
 * (with `selectionRange` + `children`) or flat `SymbolInformation[]` (with
 * `location.range`) — into a flat, depth-tagged outline list (pre-order).
 */
export function normalizeDocumentSymbols(res: unknown): LspDocumentSymbol[] {
  if (!Array.isArray(res)) return []
  const firstNum = (...vals: unknown[]): number => {
    for (const v of vals) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return 0
  }
  const out: LspDocumentSymbol[] = []
  const visit = (nodes: unknown[], depth: number): void => {
    for (const n of nodes) {
      const node = n as {
        name?: unknown
        kind?: unknown
        detail?: unknown
        range?: { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown } }
        selectionRange?: { start?: { line?: unknown; character?: unknown } }
        location?: {
          range?: { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown } }
        }
        children?: unknown[]
      }
      const name = typeof node.name === 'string' ? node.name : ''
      if (!name) continue
      const line = firstNum(
        node.selectionRange?.start?.line,
        node.range?.start?.line,
        node.location?.range?.start?.line,
      )
      out.push({
        name,
        kind: typeof node.kind === 'number' ? node.kind : 0,
        line,
        // Name start-character, from the same source that won the line above.
        character: firstNum(
          node.selectionRange?.start?.character,
          node.range?.start?.character,
          node.location?.range?.start?.character,
        ),
        // Full-span end (range.end), falling back to the name line for a point symbol.
        endLine: Math.max(
          line,
          firstNum(node.range?.end?.line, node.location?.range?.end?.line, line),
        ),
        detail:
          typeof node.detail === 'string' && node.detail.trim() ? node.detail.trim() : undefined,
        depth,
      })
      if (Array.isArray(node.children) && node.children.length) visit(node.children, depth + 1)
    }
  }
  visit(res, 0)
  return out
}

/**
 * Normalize an LSP `workspace/symbol` response — `SymbolInformation[]` (with
 * `location.range`) or the newer `WorkspaceSymbol[]` (where `location` may be a
 * bare `{ uri }` with no range) — into a flat, uri-carrying symbol list.
 */
export function normalizeWorkspaceSymbols(res: unknown): LspWorkspaceSymbol[] {
  if (!Array.isArray(res)) return []
  const out: LspWorkspaceSymbol[] = []
  for (const raw of res) {
    const s = raw as {
      name?: unknown
      kind?: unknown
      containerName?: unknown
      location?: { uri?: unknown; range?: { start?: { line?: unknown; character?: unknown } } }
    }
    const name = typeof s.name === 'string' ? s.name : ''
    const uri = typeof s.location?.uri === 'string' ? s.location.uri : ''
    if (!name || !uri) continue
    const start = s.location?.range?.start
    out.push({
      name,
      kind: typeof s.kind === 'number' ? s.kind : 0,
      containerName:
        typeof s.containerName === 'string' && s.containerName.trim()
          ? s.containerName.trim()
          : undefined,
      uri,
      line: Number.isFinite(Number(start?.line)) ? Number(start?.line) : 0,
      character: Number.isFinite(Number(start?.character)) ? Number(start?.character) : 0,
    })
  }
  return out
}
