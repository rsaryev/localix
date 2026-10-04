import { fileURLToPath } from 'node:url'
import type {
  LspCallHierarchyItem,
  LspCodeAction,
  LspCodeActionCommand,
  LspColorInfo,
  LspCompletionItem,
  LspDiagnostic,
  LspDocumentHighlight,
  LspDocumentSymbol,
  LspInlayHint,
  LspLocation,
  LspPosition,
  LspPrepareRename,
  LspRange,
  LspRelatedInformation,
  LspSignatureHelp,
  LspTextEdit,
  LspWorkspaceEditFile,
  LspWorkspaceSymbol,
} from './lsp-protocol'

// uri → absolute path; local (not imported from lsp-protocol) to keep this module
// free of a circular import (lsp-protocol re-exports from here).
function uriToPath(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return null
  try {
    return fileURLToPath(uri)
  } catch {
    return null
  }
}

function toPosition(p: unknown): LspPosition | null {
  const o = p as { line?: unknown; character?: unknown } | null
  if (!o || !Number.isFinite(Number(o.line)) || !Number.isFinite(Number(o.character))) return null
  return { line: Number(o.line), character: Number(o.character) }
}

function toRange(r: unknown): { start: LspPosition; end: LspPosition } | null {
  const o = r as { start?: unknown; end?: unknown } | null
  if (!o) return null
  const start = toPosition(o.start)
  const end = toPosition(o.end)
  return start && end ? { start, end } : null
}

function toTextEdit(raw: unknown): LspTextEdit | null {
  const e = raw as { range?: unknown; newText?: unknown } | null
  if (!e || typeof e.newText !== 'string') return null
  const range = toRange(e.range)
  return range ? { range, newText: e.newText } : null
}

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

/** Normalize a `textDocument/formatting` result: a flat `TextEdit[]` (or null). */
export function normalizeTextEdits(res: unknown): LspTextEdit[] {
  if (!Array.isArray(res)) return []
  return res.map(toTextEdit).filter((e): e is LspTextEdit => e !== null)
}

// Pure LSP response → editor-facing normalizers, split out of lsp-protocol.ts.
// Re-exported there so the `./lsp-protocol` (and `./lsp-client` barrel) surface
// stays identical for lsp-client and the tests.

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
 * Normalize a `textDocument/documentHighlight` response (`DocumentHighlight[]`)
 * — each `{ range, kind? }` — into the editor-facing occurrence list. Entries
 * with a malformed range are dropped; `kind` is kept only when it is a valid
 * DocumentHighlightKind (1 Text, 2 Read, 3 Write).
 */
export function normalizeDocumentHighlights(res: unknown): LspDocumentHighlight[] {
  if (!Array.isArray(res)) return []
  const out: LspDocumentHighlight[] = []
  for (const raw of res) {
    const h = raw as { range?: unknown; kind?: unknown }
    const range = toRange(h.range)
    if (!range) continue
    const kind = h.kind === 1 || h.kind === 2 || h.kind === 3 ? h.kind : undefined
    out.push({ range, kind })
  }
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

/**
 * Normalize an LSP `textDocument/inlayHint` response into a flat hint list.
 * A hint's `label` may be a plain string OR an `InlayHintLabelPart[]` — the
 * parts are concatenated into one string. Hints without a valid position or a
 * non-empty label are dropped. `kind` is kept only for the known values (1/2).
 */
export function normalizeInlayHints(res: unknown): LspInlayHint[] {
  if (!Array.isArray(res)) return []
  const out: LspInlayHint[] = []
  for (const raw of res) {
    const h = raw as {
      position?: unknown
      label?: unknown
      kind?: unknown
      paddingLeft?: unknown
      paddingRight?: unknown
    }
    const position = toPosition(h.position)
    if (!position) continue
    let label = ''
    if (typeof h.label === 'string') label = h.label
    else if (Array.isArray(h.label)) {
      label = h.label
        .map((p) =>
          p && typeof (p as { value?: unknown }).value === 'string'
            ? (p as { value: string }).value
            : '',
        )
        .join('')
    }
    label = label.trim()
    if (!label) continue
    out.push({
      position,
      label,
      kind: h.kind === 1 || h.kind === 2 ? h.kind : undefined,
      paddingLeft: h.paddingLeft === true ? true : undefined,
      paddingRight: h.paddingRight === true ? true : undefined,
    })
  }
  return out
}

/**
 * Normalize an LSP `textDocument/documentColor` response into a flat color list.
 * Each entry carries a `range` (the literal's span) and a `color` whose channels
 * are clamped 0..1 floats. Entries without a valid range or numeric channels are
 * dropped so the editor never paints a bogus swatch.
 */
export function normalizeDocumentColors(res: unknown): LspColorInfo[] {
  if (!Array.isArray(res)) return []
  const out: LspColorInfo[] = []
  const clamp01 = (n: unknown): number | null => {
    const v = Number(n)
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null
  }
  for (const raw of res) {
    const c = raw as {
      range?: unknown
      color?: { red?: unknown; green?: unknown; blue?: unknown; alpha?: unknown } | null
    }
    const range = toRange(c.range)
    if (!range || !c.color) continue
    const red = clamp01(c.color.red)
    const green = clamp01(c.color.green)
    const blue = clamp01(c.color.blue)
    const alpha = clamp01(c.color.alpha)
    if (red === null || green === null || blue === null || alpha === null) continue
    out.push({ range, color: { red, green, blue, alpha } })
  }
  return out
}

/** Flatten an LSP hover/markup value (string | MarkedString | MarkupContent | array) to text. */
export function markupToText(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  if (Array.isArray(input)) return input.map(markupToText).filter(Boolean).join('\n\n')
  if (typeof input === 'object') {
    const obj = input as { value?: unknown; language?: unknown }
    if (typeof obj.value === 'string') {
      // A `{language, value}` MarkedString is a code block — fence it for the tooltip.
      return typeof obj.language === 'string' && obj.language
        ? `\`\`\`${obj.language}\n${obj.value}\n\`\`\``
        : obj.value
    }
  }
  return ''
}

/** Normalize an LSP `textDocument/completion` response (CompletionItem[] | CompletionList) to the thin editor-facing shape. */
export function normalizeCompletionItems(res: unknown): LspCompletionItem[] {
  const items = Array.isArray(res) ? res : ((res as { items?: unknown[] } | null)?.items ?? [])
  return (items as Record<string, unknown>[]).flatMap((item) => {
    const label = typeof item.label === 'string' ? item.label : ''
    if (!label) return []
    return [
      {
        label,
        detail: typeof item.detail === 'string' ? item.detail : undefined,
        kind: typeof item.kind === 'number' ? item.kind : undefined,
        insertText:
          (item.textEdit as { newText?: string } | undefined)?.newText ??
          (typeof item.insertText === 'string' ? item.insertText : undefined),
        documentation: markupToText(item.documentation).trim() || undefined,
      },
    ]
  })
}

/** Normalize an LSP SignatureHelp response to the thin editor-facing shape. */
export function normalizeSignatureHelp(res: unknown): LspSignatureHelp | null {
  const r = res as {
    signatures?: {
      label?: unknown
      documentation?: unknown
      parameters?: { label?: unknown }[]
    }[]
    activeSignature?: unknown
    activeParameter?: unknown
  } | null
  const sigs = Array.isArray(r?.signatures) ? r!.signatures : []
  if (sigs.length === 0) return null
  const signatures = sigs.map((s) => {
    const label = typeof s.label === 'string' ? s.label : ''
    const params = Array.isArray(s.parameters) ? s.parameters : []
    const parameters = params
      .map((p) => {
        if (typeof p.label === 'string') return p.label
        // A [start, end] tuple indexes into the signature label.
        if (Array.isArray(p.label) && label)
          return label.slice(Number(p.label[0]) || 0, Number(p.label[1]) || 0)
        return ''
      })
      .filter(Boolean)
    return { label, parameters, documentation: markupToText(s.documentation).trim() || undefined }
  })
  return {
    signatures,
    activeSignature: typeof r?.activeSignature === 'number' ? r.activeSignature : 0,
    activeParameter: typeof r?.activeParameter === 'number' ? r.activeParameter : 0,
  }
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
 * Flatten an LSP `WorkspaceEdit` — both the legacy `changes: {uri: TextEdit[]}`
 * map AND the newer `documentChanges: TextDocumentEdit[]` form — into one entry
 * per changed file with absolute paths. Resource ops (create/rename/delete file,
 * which carry a `kind` and no `edits`) are skipped; only text edits are returned.
 */
export function normalizeWorkspaceEdit(res: unknown): LspWorkspaceEditFile[] {
  if (!res || typeof res !== 'object') return []
  const we = res as {
    changes?: Record<string, unknown[]>
    documentChanges?: unknown[]
  }
  const byFile = new Map<string, LspTextEdit[]>()
  const add = (uri: unknown, edits: unknown): void => {
    const file = uriToPath(uri)
    if (!file || !Array.isArray(edits)) return
    const norm = edits.map(toTextEdit).filter((e): e is LspTextEdit => e !== null)
    if (norm.length) byFile.set(file, [...(byFile.get(file) ?? []), ...norm])
  }
  if (we.changes && typeof we.changes === 'object') {
    for (const [uri, edits] of Object.entries(we.changes)) add(uri, edits)
  }
  if (Array.isArray(we.documentChanges)) {
    for (const dc of we.documentChanges) {
      const tde = dc as { textDocument?: { uri?: unknown }; edits?: unknown }
      if (Array.isArray(tde.edits)) add(tde.textDocument?.uri, tde.edits)
    }
  }
  return [...byFile.entries()].map(([file, edits]) => ({ file, edits }))
}

/**
 * Normalize a single `textDocument/codeAction` entry. Bare `Command` literals
 * (a string `command` with no `edit`) are dropped by the caller — the MVP only
 * applies the `edit` path. A `CodeAction` literal keeps its title/kind/edit and
 * the opaque `data` needed to round-trip a lazy `codeAction/resolve`. Returns
 * null for a titleless or `disabled` action.
 */
export function normalizeCodeAction(raw: unknown): LspCodeAction | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as {
    title?: unknown
    kind?: unknown
    isPreferred?: unknown
    disabled?: unknown
    edit?: unknown
    command?: unknown
    data?: unknown
  }
  const title = typeof a.title === 'string' ? a.title.trim() : ''
  if (!title) return null
  // `disabled` = the server says this action can't currently be applied — skip.
  if (a.disabled && typeof a.disabled === 'object') return null
  const kind = typeof a.kind === 'string' ? a.kind : undefined
  const edit = a.edit ? normalizeWorkspaceEdit(a.edit) : []
  // The command form on a CodeAction is an object; a string here means this is a
  // bare Command literal (handled/skipped by normalizeCodeActions).
  let command: LspCodeActionCommand | undefined
  if (a.command && typeof a.command === 'object') {
    const c = a.command as { command?: unknown; title?: unknown; arguments?: unknown }
    if (typeof c.command === 'string') {
      command = {
        command: c.command,
        title: typeof c.title === 'string' ? c.title : title,
        arguments: Array.isArray(c.arguments) ? c.arguments : undefined,
      }
    }
  }
  return {
    title,
    kind,
    isPreferred: a.isPreferred === true ? true : undefined,
    edit: edit.length ? edit : undefined,
    command,
    data: a.data,
  }
}

/**
 * Normalize a `textDocument/codeAction` response (`(Command | CodeAction)[]`) to
 * the editor-facing action list. Bare `Command` literals are dropped (no
 * client-side `workspace/executeCommand` — graceful degrade for command-only
 * source actions). The result is scoped by kind-PREFIX to `allowedKinds`
 * (default `['quickfix']`): an action is kept when its `kind` starts with ANY
 * allowed entry — so `['source']` keeps `source.organizeImports`, and
 * `['source.organizeImports']` keeps only that. A `kind`-less action is always
 * kept (many servers omit it on the primary fix).
 */
export function normalizeCodeActions(
  res: unknown,
  allowedKinds: string[] = ['quickfix'],
): LspCodeAction[] {
  if (!Array.isArray(res)) return []
  const out: LspCodeAction[] = []
  for (const raw of res) {
    // A bare Command literal: `command` is a string and there is no `edit`. Skip.
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as { command?: unknown }).command === 'string' &&
      !(raw as { edit?: unknown }).edit
    )
      continue
    const action = normalizeCodeAction(raw)
    if (!action) continue
    const kind = action.kind
    if (kind && !allowedKinds.some((allowed) => kind.startsWith(allowed))) continue
    out.push(action)
  }
  return out
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

/**
 * Normalize an LSP `textDocument/prepareRename` reply. Handles the three success
 * shapes — a bare `Range`, `{ range, placeholder }`, and `{ defaultBehavior: true }`
 * (→ `range: null`, the editor computes the word at the cursor). A rejection
 * (`{ message }`) or anything else returns `null` (rename not allowed).
 */
export function normalizePrepareRename(res: unknown): LspPrepareRename | null {
  if (!res || typeof res !== 'object') return null
  const r = res as {
    range?: unknown
    placeholder?: unknown
    defaultBehavior?: unknown
    start?: unknown
    end?: unknown
  }
  if (r.defaultBehavior === true) return { range: null }
  // { range, placeholder }
  const tagged = toRange(r.range)
  if (tagged) {
    return {
      range: tagged,
      placeholder: typeof r.placeholder === 'string' ? r.placeholder : undefined,
    }
  }
  // bare Range (start/end at the top level)
  const bare = toRange(r)
  if (bare) return { range: bare }
  return null
}
