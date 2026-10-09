import type {
  LspCodeAction,
  LspCodeActionCommand,
  LspTextEdit,
  LspWorkspaceEditFile,
  LspPrepareRename,
} from './lsp-protocol'
import { uriToPath, toRange, toTextEdit } from './lsp-normalize-values'

/** Normalize a `textDocument/formatting` result: a flat `TextEdit[]` (or null). */
export function normalizeTextEdits(res: unknown): LspTextEdit[] {
  if (!Array.isArray(res)) return []
  return res.map(toTextEdit).filter((e): e is LspTextEdit => e !== null)
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
