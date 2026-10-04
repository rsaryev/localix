import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapLimit } from '../../lib/map-limit'
import type { LspManager } from './lsp-manager'
import type {
  LspCodeAction,
  LspDiagnostic,
  LspPosition,
  LspRange,
  LspHoverInfo,
  LspCompletionItem,
  LspSignatureHelp,
  LspInlayHint,
  LspColorInfo,
  LspDocumentSymbol,
  LspDocumentHighlight,
  LspFormattingOptions,
} from './lsp-client'
import type { CodeActionTrigger, LspWorkspaceEditFile } from './lsp-protocol'
import { createLspEditCommitter } from './edit-commit'
import { bufferEditFor, routeWorkspaceEdit } from './edit-routing'
import type { BufferEdit } from './lsp-edits'

/** A resolved code location (absolute path + 0-based position). */
export interface CodeLocation {
  file: string
  line: number
  character: number
}

/** A reference with display label + a one-line preview of the target line. */
export interface CodeReference extends CodeLocation {
  fileLabel: string
  preview: string
}

/** A project-wide symbol hit (workspace/symbol) — name + kind + resolved location. */
export interface WorkspaceSymbol extends CodeLocation {
  name: string
  /** LSP SymbolKind (1–26). */
  kind: number
  /** Enclosing container (class/namespace/file), when the server provides it. */
  containerName?: string
}

const uriToPath = (uri: string): string | null => {
  try {
    return fileURLToPath(uri)
  } catch {
    return null
  }
}

const DEFINITION_SELF_RETRY_MS = [75, 150, 300, 600, 600] as const
const MAX_DEFINITION_RESULTS = 64

function positionInRange(position: LspPosition, range: LspRange): boolean {
  const afterStart =
    position.line > range.start.line ||
    (position.line === range.start.line && position.character >= range.start.character)
  const beforeEnd =
    position.line < range.end.line ||
    (position.line === range.end.line && position.character <= range.end.character)
  return afterStart && beforeEnd
}

/**
 * During initial TypeScript project loading vtsls can temporarily return the
 * import binding itself as its own definition. Monaco then opens the exact same
 * cursor span, which looks like Cmd+Click did nothing. A real local declaration
 * reached from a usage has a different span, so this predicate isolates that
 * transient response without delaying normal local-variable/function navigation.
 */
function isSelfDefinition(
  file: string,
  position: LspPosition,
  location: { uri: string; range: LspRange },
): boolean {
  return uriToPath(location.uri) === file && positionInRange(position, location.range)
}

async function readLinePreview(
  path: string,
  line: number,
  cache: Map<string, Promise<string[]>>,
): Promise<string> {
  try {
    let read = cache.get(path)
    if (!read) {
      read = Bun.file(path)
        .text()
        .then((text) => text.split('\n'))
      cache.set(path, read)
    }
    const lines = await read
    const text = (lines[line] ?? '').trim()
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  } catch {
    return ''
  }
}

/**
 * Shape raw LSP locations into `CodeReference[]` (absolute path + label + 0-based
 * position + a one-line preview) — the single form the references peek renders.
 * Shared by `references`, `implementation`, and `typeDefinition` so all three feed
 * the SAME peek UI. Unresolvable uris are skipped; the line cache is reused across
 * a single call so repeated hits in one file read the file once.
 */
async function toReferences(
  locs: { uri: string; range: { start: { line: number; character: number } } }[],
): Promise<CodeReference[]> {
  const cache = new Map<string, Promise<string[]>>()
  const refs = await mapLimit(locs, 16, async (loc): Promise<CodeReference | null> => {
    const path = uriToPath(loc.uri)
    if (!path) return null
    return {
      file: path,
      fileLabel: basename(path),
      line: loc.range.start.line,
      character: loc.range.start.character,
      preview: await readLinePreview(path, loc.range.start.line, cache),
    }
  })
  return refs.filter((ref): ref is CodeReference => ref !== null)
}

/**
 * Per-file diagnostics push routed to one session's event stream. Defined HERE so
 * the LSP feature owns its data shape and imports nothing from `features/chat`;
 * the transport layer (bootstrap) wraps this into the chat `lsp.diagnostics`
 * stream event.
 */
export interface LspDiagnosticsPush {
  file: string
  diagnostics: LspDiagnostic[]
}

/** Result of `prepareRename` — the symbol span to rename + a placeholder name for the input. */
export interface RenamePrepare {
  /** Span to cover with the rename input (null = server gave `defaultBehavior`; editor uses the word at cursor). */
  range: { start: LspPosition; end: LspPosition } | null
  placeholder?: string
}

/** A format is always a buffer edit: the editor that asked applies it to its live text. */
export type FormatResult = BufferEdit

/**
 * Result of a rename or an applied code action. Files an editor holds open come back as
 * `bufferEdits` for that editor to apply; `changedFiles`/`files` are the ones committed to disk.
 */
export interface RenameResult {
  changedFiles: string[]
  /** Per changed file: its new content, plus a unified diff of the change (for a card / review). */
  files: { file: string; content: string; diff: string }[]
  /** Edits for documents an editor holds open, computed against — and fingerprinted by — that buffer. */
  bufferEdits?: BufferEdit[]
  /**
   * Files the edit targeted but could NOT be written, with why. Absent on a clean commit.
   *
   * A workspace edit is committed file-by-file with no rollback, so a failure partway leaves the
   * workspace INCONSISTENT — a rename applied to 2 of 5 files is broken code. That outcome is
   * reportable rather than avoidable here, so it must be reported: the caller names the split
   * instead of surfacing an opaque throw.
   */
  failed?: { file: string; reason: string }[]
}

export interface LspDocumentService {
  /** Editor opened a file — sync its buffer to the server and push diagnostics.
   *  `consumerId` identifies the HOLDER (one per connection): the document stays open
   *  on the server until every holder has closed it. */
  open(
    userId: string,
    sessionId: string,
    file: string,
    content: string,
    consumerId?: string,
  ): Promise<void>
  /** Editor buffer changed — re-sync and push fresh diagnostics. */
  change(userId: string, sessionId: string, file: string, content: string): Promise<void>
  /**
   * The text of `file` as an editor this user holds it open — possibly UNSAVED — or undefined
   * when no editor has it open. Read by the agent's file tools so a write the person's unsaved
   * edits will collide with says so (`chat/runtime/run/editor-buffer-note.ts`).
   */
  openBufferText(this: void, userId: string, file: string): string | undefined
  /** Editor wrote the open buffer to disk — `didSave`, which check-on-save servers act on. */
  save(userId: string, sessionId: string, file: string): Promise<void>
  /** Editor closed the file for ONE holder — server state is released only once no
   *  other holder (and no other session) still has it open. */
  close(userId: string, sessionId: string, file: string, consumerId?: string): Promise<void>
  /** Hover type info at a position (request/response). */
  hover(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspHoverInfo | null>
  /** Completion items at a position (request/response). */
  completion(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspCompletionItem[]>
  /** Signature help (parameter hints) at a position (request/response). */
  signatureHelp(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspSignatureHelp | null>
  /** Inline inlay hints (type/parameter annotations) for a range (request/response). */
  inlayHint(
    userId: string,
    sessionId: string,
    file: string,
    range: LspRange,
  ): Promise<LspInlayHint[]>
  /** Color literals in the document for swatch decorations (request/response). */
  documentColor(userId: string, sessionId: string, file: string): Promise<LspColorInfo[]>
  /** Document symbols (outline) for a file (request/response). */
  documentSymbols(userId: string, sessionId: string, file: string): Promise<LspDocumentSymbol[]>
  /** Project-wide symbol search (workspace/symbol) backing the ⌘T palette. */
  workspaceSymbols(userId: string, sessionId: string, query: string): Promise<WorkspaceSymbol[]>
  /** Definition locations at a position. Multiple targets stay intact so the editor can peek. */
  definition(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeLocation[]>
  /** Implementation locations at a position (with previews); [] when unsupported / none. The
   *  editor jumps to the single result or opens the references-style peek when there are several. */
  implementation(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeReference[]>
  /** Type-definition locations at a position (with previews); [] when unsupported / none. The
   *  editor jumps to the single result or opens the references-style peek when there are several. */
  typeDefinition(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeReference[]>
  /** Reference locations at a position (with previews, for the references list). */
  references(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeReference[]>
  /** Occurrences of the symbol under the cursor in this document (for occurrence highlighting). */
  documentHighlight(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspDocumentHighlight[]>
  /** Validate renameability at a position (textDocument/prepareRename), null when not allowed. */
  prepareRename(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<RenamePrepare | null>
  /**
   * Rename the symbol at a position across the workspace. Files an editor holds open
   * come back as `bufferEdits`; the rest are committed to disk through the injected
   * file-write primitive (the same one the editor save uses).
   */
  rename(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
    newName: string,
  ): Promise<RenameResult>
  /**
   * Format the whole OPEN document (textDocument/formatting) and return the edits
   * for the editor's buffer, fingerprinted by the text they were computed against.
   * Null when the document is not open, there were no edits, or no formatter.
   */
  formatDocument(
    userId: string,
    sessionId: string,
    file: string,
    options: LspFormattingOptions,
  ): Promise<FormatResult | null>
  /**
   * Code actions for a range (textDocument/codeAction), scoped by `kinds`
   * (default `['quickfix']`) — also `['source.organizeImports']`, `['source','refactor']`, etc.
   */
  codeAction(
    userId: string,
    sessionId: string,
    file: string,
    range: LspRange,
    kinds?: string[],
    trigger?: CodeActionTrigger,
  ): Promise<LspCodeAction[]>
  /**
   * Apply a code action: resolve its lazy `edit` if needed (codeAction/resolve),
   * then route its WorkspaceEdit exactly as `rename` does (open buffers get edits,
   * the rest commit to disk). Command-only actions with no edit degrade gracefully
   * to an empty result.
   */
  applyCodeAction(
    userId: string,
    sessionId: string,
    file: string,
    action: LspCodeAction,
  ): Promise<RenameResult>
  dispose(): void
}

export interface LspServiceDeps {
  lspManager: LspManager
  /**
   * Resolve a session's project root WITH an ownership check (throws/ rejects for
   * a session the user doesn't own). Injected so this stays decoupled from chat.
   */
  resolveProjectRoot: (userId: string, sessionId: string) => Promise<string>
  /** Emit a diagnostics push onto the given session's event stream. */
  publish: (userId: string, sessionId: string, push: LspDiagnosticsPush) => void
  /**
   * Persist full file content through the editor's locked, optimistic-concurrency
   * write path (injected so this stays decoupled from `features/chat`). Used to
   * commit a rename's WorkspaceEdit to disk via the SAME primitive an editor save
   * uses, so its file-change tracking stays coherent. Returns the new content hash.
   */
  writeFile: (
    userId: string,
    sessionId: string,
    file: string,
    content: string,
    baseHash: string,
  ) => Promise<{ hash: string }>
}

/** Consumer id for a caller that doesn't identify itself (tests, internal callers) —
 *  preserves the old one-holder behaviour rather than silently refcounting to zero. */
const SOLE_CONSUMER = '@sole'

interface OpenDoc {
  userId: string
  sessionId: string
  projectRoot: string
  file: string
  /**
   * Who currently holds this buffer open. A (session, file) pair is NOT one consumer:
   * there is one WebSocket per browser tab, so two tabs on the same file each open it,
   * and a split editor group does the same over one socket. They collapsed into a
   * single entry here, so whichever one closed FIRST told the language server to close
   * the document out from under the others.
   */
  consumers: Set<string>
  /** JSON of the last payload sent, to skip redundant re-pushes. */
  lastSent: string
  /**
   * Latest didOpen/didChange round-trip for this buffer. The realtime transport
   * acknowledges document sync immediately, so editor intelligence can otherwise
   * race vtsls startup and ask for a definition before the document exists there.
   * Chaining changes also keeps monotonically-increasing LSP versions in order.
   */
  syncing: Promise<void>
  /**
   * The text the language server holds for this buffer once `syncing` settles — what every
   * range it answers with is computed against, so it is what `edit-routing.ts` fingerprints
   * when an edit goes back to the editor's buffer instead of to disk.
   */
  text: string
}

/**
 * Bridges the transport-agnostic {@link LspManager} to per-session diagnostics
 * pushes. Tracks which (session, file) pairs the editor has open so an async
 * re-publish from the language server (diagnostics often arrive in several waves)
 * reaches the right session's stream.
 */
export function createLspDocumentService(deps: LspServiceDeps): LspDocumentService {
  const key = (sessionId: string, file: string) => `${sessionId}\n${file}`
  const open = new Map<string, OpenDoc>()
  // Recorded synchronously when open() is called, before its first await settles.
  // The websocket acknowledges lsp.open immediately, so another RPC may arrive
  // while even project-root resolution is still in flight.
  const pendingOpen = new Map<string, { userId: string; promise: Promise<void> }>()
  const byRoot = new Map<string, Set<string>>()

  function publishFor(doc: OpenDoc): void {
    const diagnostics = deps.lspManager.getFileDiagnostics(doc.projectRoot, doc.file)
    const payload = JSON.stringify(diagnostics)
    if (payload === doc.lastSent) return
    doc.lastSent = payload
    deps.publish(doc.userId, doc.sessionId, { file: doc.file, diagnostics })
  }

  // Any server status/diagnostics change for a root re-pushes every file the
  // editor has open under it — bounds egress to actually-open documents.
  const unsubscribe = deps.lspManager.onUpdate((projectRoot) => {
    const keys = byRoot.get(projectRoot)
    if (!keys) return
    for (const k of keys) {
      const doc = open.get(k)
      if (doc) publishFor(doc)
    }
  })

  // A rename's or a code action's WorkspaceEdit: files an editor holds open go back to that
  // buffer, the rest commit to disk (`edit-routing.ts`; `edit-commit.ts` owns the
  // optimistic-concurrency baseline of the disk half).
  const { commitWorkspaceEdit } = createLspEditCommitter(deps.writeFile)
  async function applyWorkspaceEdit(
    userId: string,
    sessionId: string,
    fileEdits: LspWorkspaceEditFile[],
  ): Promise<RenameResult> {
    const docs = new Map<string, OpenDoc>()
    for (const { file } of fileEdits) {
      const doc = open.get(key(sessionId, file))
      if (doc?.userId !== userId) continue
      // Every range is computed against the text the server holds once this settles.
      await doc.syncing.catch(() => {})
      docs.set(file, doc)
    }
    return routeWorkspaceEdit(
      fileEdits,
      (file) => docs.get(file)?.text,
      (diskEdits) => commitWorkspaceEdit(userId, sessionId, diskEdits),
    )
  }

  async function ownedOpenDoc(
    userId: string,
    sessionId: string,
    file: string,
  ): Promise<OpenDoc | undefined> {
    const k = key(sessionId, file)
    let doc = open.get(k)
    if (doc?.userId === userId) return doc
    const pending = pendingOpen.get(k)
    if (pending?.userId === userId) {
      await pending.promise.catch(() => {})
      doc = open.get(k)
    }
    return doc?.userId === userId ? doc : undefined
  }

  /** Resolve a file-scoped request against the latest unsaved editor buffer. */
  async function projectRootAfterSync(
    userId: string,
    sessionId: string,
    file: string,
  ): Promise<string> {
    const doc = await ownedOpenDoc(userId, sessionId, file)
    if (doc) {
      await doc.syncing.catch(() => {})
      return doc.projectRoot
    }
    return deps.resolveProjectRoot(userId, sessionId)
  }

  return {
    open(userId, sessionId, file, content, consumerId = SOLE_CONSUMER) {
      const k = key(sessionId, file)
      const operation = (async () => {
        const projectRoot = await deps.resolveProjectRoot(userId, sessionId)
        // A second holder of the SAME buffer joins the existing entry rather than
        // replacing it — overwriting was what lost the first holder's claim.
        const prior = open.get(k)
        const doc: OpenDoc =
          prior?.userId === userId && prior.projectRoot === projectRoot
            ? prior
            : {
                userId,
                sessionId,
                projectRoot,
                file,
                consumers: new Set(),
                lastSent: '',
                syncing: Promise.resolve(),
                text: content,
              }
        doc.consumers.add(consumerId)
        open.set(k, doc)
        let set = byRoot.get(projectRoot)
        if (!set) {
          set = new Set()
          byRoot.set(projectRoot, set)
        }
        set.add(k)
        doc.syncing = doc.syncing
          .catch(() => {})
          .then(async () => {
            await deps.lspManager.openDocument(projectRoot, file, content)
            doc.text = content
          })
        await doc.syncing
        publishFor(doc)
      })()
      const pending = { userId, promise: operation }
      pendingOpen.set(k, pending)
      const clearPending = () => {
        if (pendingOpen.get(k) === pending) pendingOpen.delete(k)
      }
      void operation.then(clearPending, clearPending)
      return operation
    },

    async change(userId, sessionId, file, content) {
      const doc = await ownedOpenDoc(userId, sessionId, file)
      // Ownership: only the user who opened the doc may mutate it. Session ids are
      // enumerable, so a sessionId-only lookup would let another user corrupt an
      // open buffer + trigger diagnostics on a session they don't own.
      if (!doc || doc.userId !== userId) return // (also: change before open — editor opens on mount)
      // ORDERING INVARIANT: this extension of `doc.syncing` is the barrier every
      // read-side request awaits (see `projectRootAfterSync`). The editor fires
      // `lsp.change` WITHOUT awaiting it and asks for a format immediately after, so a
      // format answered against the pre-change document would compute ranges that
      // `edit-commit` then applies to the newer bytes on disk — a silently corrupted
      // file on save. It holds only because this handler is invoked first and its
      // continuation is queued first; the assignment already sits behind one `await`.
      // Do NOT add another await above it. Pinned by `service-sync-order.test.ts`.
      doc.syncing = doc.syncing
        .catch(() => {})
        .then(async () => {
          await deps.lspManager.changeDocument(doc.projectRoot, file, content)
          doc.text = content
        })
      await doc.syncing
      publishFor(doc)
    },

    openBufferText(userId, file) {
      for (const doc of open.values()) {
        if (doc.userId === userId && doc.file === file) return doc.text
      }
      return undefined
    },

    async save(userId, sessionId, file) {
      const doc = await ownedOpenDoc(userId, sessionId, file)
      if (!doc) return
      // Behind the buffer's own sync, so the save names the text the server already holds.
      await doc.syncing.catch(() => {})
      await deps.lspManager.saveDocument(doc.projectRoot, file)
    },

    async close(userId, sessionId, file, consumerId = SOLE_CONSUMER) {
      const k = key(sessionId, file)
      const doc = await ownedOpenDoc(userId, sessionId, file)
      if (!doc) return
      doc.consumers.delete(consumerId)
      // Still held by another tab / split pane — nothing to release yet.
      if (doc.consumers.size > 0) return
      open.delete(k)
      const set = byRoot.get(doc.projectRoot)
      set?.delete(k)
      if (set?.size === 0) byRoot.delete(doc.projectRoot)
      // Only tell the server to close when no OTHER session still has it open.
      const stillOpen = [...open.values()].some(
        (d) => d.projectRoot === doc.projectRoot && d.file === file,
      )
      if (!stillOpen) {
        // A socket may close while the fire-and-acknowledge open is still starting
        // vtsls. Closing before that didOpen settles would let the late didOpen
        // resurrect an unowned document in the server.
        await doc.syncing.catch(() => {})
        await deps.lspManager.closeDocument(doc.projectRoot, file).catch(() => {})
      }
    },

    async hover(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return deps.lspManager.hover(projectRoot, file, position)
    },

    async completion(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return deps.lspManager.completion(projectRoot, file, position)
    },

    async signatureHelp(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return deps.lspManager.signatureHelp(projectRoot, file, position)
    },

    async inlayHint(userId, sessionId, file, range) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return deps.lspManager.inlayHint(projectRoot, file, range)
    },

    async documentColor(userId, sessionId, file) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return deps.lspManager.documentColor(projectRoot, file)
    },

    async documentSymbols(userId, sessionId, file) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return deps.lspManager.documentSymbols(projectRoot, file)
    },

    async workspaceSymbols(userId, sessionId, query) {
      const trimmed = query.trim()
      if (!trimmed) return []
      const projectRoot = await deps.resolveProjectRoot(userId, sessionId)
      const raw = await deps.lspManager.workspaceSymbols(projectRoot, trimmed)
      const out: WorkspaceSymbol[] = []
      const seen = new Set<string>()
      for (const s of raw) {
        const path = uriToPath(s.uri)
        if (!path) continue
        // Merge duplicates the same symbol can produce across overlapping servers.
        const key = `${s.name}:${path}:${s.line}:${s.character}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          name: s.name,
          kind: s.kind,
          containerName: s.containerName,
          file: path,
          line: s.line,
          character: s.character,
        })
      }
      return out.slice(0, 200)
    },

    async definition(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      let locations = await deps.lspManager.definition(projectRoot, file, position)
      for (const delay of DEFINITION_SELF_RETRY_MS) {
        if (
          locations.length === 0 ||
          locations.some((loc) => !isSelfDefinition(file, position, loc))
        ) {
          break
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delay))
        locations = await deps.lspManager.definition(projectRoot, file, position)
      }
      const hasExternalTarget = locations.some((loc) => !isSelfDefinition(file, position, loc))
      const seen = new Set<string>()
      const resolved: CodeLocation[] = []
      for (const loc of locations) {
        if (hasExternalTarget && isSelfDefinition(file, position, loc)) continue
        const path = uriToPath(loc.uri)
        if (!path) continue
        const key = `${path}:${loc.range.start.line}:${loc.range.start.character}`
        if (seen.has(key)) continue
        seen.add(key)
        resolved.push({
          file: path,
          line: loc.range.start.line,
          character: loc.range.start.character,
        })
        if (resolved.length >= MAX_DEFINITION_RESULTS) break
      }
      return resolved
    },

    async implementation(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return toReferences(await deps.lspManager.implementation(projectRoot, file, position))
    },

    async typeDefinition(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return toReferences(await deps.lspManager.typeDefinition(projectRoot, file, position))
    },

    async references(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return toReferences(await deps.lspManager.references(projectRoot, file, position))
    },

    async documentHighlight(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return deps.lspManager.documentHighlight(projectRoot, file, position)
    },

    async prepareRename(userId, sessionId, file, position) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return deps.lspManager.prepareRename(projectRoot, file, position)
    },

    async rename(userId, sessionId, file, position, newName) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      const fileEdits = await deps.lspManager.rename(projectRoot, file, position, newName)
      return applyWorkspaceEdit(userId, sessionId, fileEdits)
    },

    async codeAction(userId, sessionId, file, range, kinds, trigger) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      return deps.lspManager.codeAction(projectRoot, file, range, kinds, trigger)
    },

    async applyCodeAction(userId, sessionId, file, action) {
      const projectRoot = await projectRootAfterSync(userId, sessionId, file)
      // MVP prioritizes the `edit` path: use an eager edit if present, else resolve
      // it lazily (vtsls/tsserver populate edits on codeAction/resolve).
      let fileEdits = action.edit
      if (!fileEdits || fileEdits.length === 0) {
        const resolved = await deps.lspManager.resolveCodeAction(projectRoot, file, action)
        fileEdits = resolved?.edit
      }
      // No edit (command-only action, no executeCommand support) → degrade to a no-op.
      if (!fileEdits || fileEdits.length === 0) return { changedFiles: [], files: [] }
      return applyWorkspaceEdit(userId, sessionId, fileEdits)
    },

    async formatDocument(userId, sessionId, file, options) {
      // Formatting is a buffer operation: the editor asks for it on its live text (Format
      // Document, format-on-save) and applies the edits itself. A document nobody holds open
      // has no buffer to format, and writing to disk behind an editor is what this replaced.
      const doc = await ownedOpenDoc(userId, sessionId, file)
      if (!doc) return null
      await doc.syncing.catch(() => {})
      const edits = await deps.lspManager.formatDocument(doc.projectRoot, file, options)
      return bufferEditFor(file, doc.text, edits)
    },

    dispose() {
      unsubscribe()
      open.clear()
      pendingOpen.clear()
      byRoot.clear()
    },
  }
}
