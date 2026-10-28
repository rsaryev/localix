import type { LspDocumentService, LspServiceDeps, OpenDoc } from './service-contract'
import { createLspEditCommitter } from './edit-commit'
import { bufferEditFor } from './edit-routing'
import { createWorkspaceEditApplicator } from './service-workspace-edit'
import { createServiceNavigation } from './service-navigation'
import { createStatusPublisher } from './service-status'

export type { LspDocumentService, LspServiceDeps } from './service-contract'
export type {
  CodeLocation,
  CodeReference,
  WorkspaceSymbol,
  RenamePrepare,
  RenameResult,
} from './service-result-types'

/** Consumer id for a caller that doesn't identify itself (tests, internal callers) —
 *  preserves the old one-holder behaviour rather than silently refcounting to zero. */
const SOLE_CONSUMER = '@sole'

/**
 * Bridges the transport-agnostic `LspManager` to per-session diagnostics
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

  const publishStatus = createStatusPublisher(deps.publishStatus)

  // Any server status/diagnostics change for a root re-pushes every file the
  // editor has open under it — bounds egress to actually-open documents.
  const unsubscribe = deps.lspManager.onUpdate((projectRoot, states) => {
    const keys = byRoot.get(projectRoot)
    if (!keys) return
    const docs: OpenDoc[] = []
    for (const k of keys) {
      const doc = open.get(k)
      if (!doc) continue
      publishFor(doc)
      docs.push(doc)
    }
    publishStatus(docs, states)
  })

  // A rename's or a code action's WorkspaceEdit: files an editor holds open go back to that
  // buffer, the rest commit to disk (`edit-routing.ts`; `edit-commit.ts` owns the
  // optimistic-concurrency baseline of the disk half).
  const { commitWorkspaceEdit } = createLspEditCommitter(deps.writeFile)
  const applyWorkspaceEdit = createWorkspaceEditApplicator({
    getOpenDoc: (sessionId, file) => open.get(key(sessionId, file)),
    commitWorkspaceEdit,
  })

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

    ...createServiceNavigation({
      getManager: () => deps.lspManager,
      resolveProjectRoot: (userId, sessionId) => deps.resolveProjectRoot(userId, sessionId),
      projectRootAfterSync,
    }),

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
