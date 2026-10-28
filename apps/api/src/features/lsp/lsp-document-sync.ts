import type { MessageConnection } from 'vscode-jsonrpc/node'
import { languageIdForPath } from './lsp-languages'
import { minimalEdit } from './lsp-incremental'
import {
  DIAGNOSTICS_WAIT_TIMEOUT_MS,
  FILE_CHANGE_CHANGED,
  FILE_CHANGE_CREATED,
  TEXT_DOCUMENT_SYNC_INCREMENTAL,
  fileUri,
} from './lsp-protocol'
import { WATCHED_CHANGE_CODE, type LspWatchedFileChange } from './lsp-watched-files'

interface DocumentSyncPorts {
  connection: MessageConnection
  openedFiles: Map<string, { version: number; text: string }>
  pushDiagnostics: { delete(filePath: string): boolean }
  pullDiagnostics: { delete(filePath: string): boolean }
  syncKind: number | undefined
  saveCarriesText: boolean
  isDisposed: () => boolean
  waitForPush: (filePath: string, timeout: number) => Promise<boolean>
  requestDiagnostics: (filePath: string) => Promise<{ handled: boolean; matched: boolean }>
  /** The server's own language id for a file (a plugin's `extensionToLanguage`). */
  languageIdFor?: (filePath: string) => string | undefined
}

/** Synchronize editor buffers and transient disk reads through the same document lifecycle. */
export function createDocumentSync({
  connection,
  openedFiles,
  pushDiagnostics,
  pullDiagnostics,
  syncKind,
  saveCarriesText,
  isDisposed,
  waitForPush,
  requestDiagnostics,
  languageIdFor,
}: DocumentSyncPorts) {
  async function touchFileAndWait(filePath: string, wait = true): Promise<boolean> {
    if (isDisposed()) return false
    let content: string
    try {
      content = await Bun.file(filePath).text()
    } catch {
      return false
    }
    const alreadyOpen = openedFiles.has(filePath)
    try {
      // Disk path: the content was just READ FROM DISK because it changed there
      // (agent write / patch / formatter), so the watched-file event is genuine.
      return await syncDocumentInternal(filePath, content, wait, true)
    } finally {
      // Agent write diagnostics are a transient disk read, not editor ownership.
      // Leaving every touched file open pins project graphs and diagnostics forever.
      // Version 0 is the transient didOpen issued above. If an editor claimed or
      // changed the document while diagnostics were settling it increments the
      // version, so this call must not close the editor's newer ownership.
      if (!alreadyOpen && openedFiles.get(filePath)?.version === 0)
        await closeDocumentInternal(filePath, false)
    }
  }

  // Shared didOpen/didChange dispatch. Editor navigation only needs the document
  // to exist in the server, while the agent write path must wait for diagnostics;
  // coupling both to the 6s clean-file timeout made early Cmd+Click feel broken.
  async function syncDocumentInternal(
    filePath: string,
    content: string,
    waitForDiagnostics: boolean,
    /**
     * Whether this sync reflects a change to the file ON DISK (an agent write, a
     * patch, a formatter) as opposed to an editor buffer the user is typing into.
     * Only a real disk change may be announced as `workspace/didChangeWatchedFiles`
     * — the spec defines that notification as sent "when the client detects changes
     * to file watched by the language client". A keystroke is not that: the buffer
     * moved, the file did not, and telling the server otherwise makes it invalidate
     * and re-read the path from disk — where it finds the STALE unsaved content —
     * on every 150ms editor sync. `didOpen`/`didChange` are how a buffer is
     * communicated, and they are sent either way.
     */
    diskChanged: boolean,
  ): Promise<boolean> {
    if (isDisposed()) return false

    const languageId = languageIdFor?.(filePath) ?? languageIdForPath(filePath)
    const opened = openedFiles.get(filePath)
    const startedAt = Date.now()

    // The strict write/diagnostics path starts waiting BEFORE the notification so
    // it cannot miss a fast push. Editor sync relies on the normal push callback
    // and must not accumulate one 6s timer/listener per keystroke.
    const pushWait = waitForDiagnostics ? waitForPush(filePath, DIAGNOSTICS_WAIT_TIMEOUT_MS) : null

    if (opened === undefined) {
      // New to this server. Only a genuine disk change is announced to the file
      // watcher; an editor opening a buffer says so with didOpen alone.
      if (diskChanged) {
        await connection.sendNotification('workspace/didChangeWatchedFiles', {
          changes: [{ uri: fileUri(filePath), type: FILE_CHANGE_CREATED }],
        })
      }
      await connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri: fileUri(filePath), languageId, version: 0, text: content },
      })
      openedFiles.set(filePath, { version: 0, text: content })
      pushDiagnostics.delete(filePath)
      pullDiagnostics.delete(filePath)
    } else {
      // Already open — fire didChangeWatchedFiles + didChange
      const next = opened.version + 1
      openedFiles.set(filePath, { version: next, text: content })

      if (diskChanged) {
        await connection.sendNotification('workspace/didChangeWatchedFiles', {
          changes: [{ uri: fileUri(filePath), type: FILE_CHANGE_CHANGED }],
        })
      }

      // When the server accepts ranged edits, send the actual DELTA. The previous
      // text is right here, so the whole buffer never has to go back over the wire:
      // measured at 1.04 MB per sync for a 1 MB file, which is what a 150ms typing
      // debounce turns into ~7 MB/s of JSON-RPC. The old "incremental" branch
      // declared a range and then filled it with the entire document, so it cost the
      // same as the full-sync form while claiming not to.
      const delta =
        syncKind === TEXT_DOCUMENT_SYNC_INCREMENTAL ? minimalEdit(opened.text, content) : null
      await connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: fileUri(filePath), version: next },
        contentChanges:
          syncKind === TEXT_DOCUMENT_SYNC_INCREMENTAL
            ? // `null` means the text is unchanged; an empty change list is the
              // correct way to say "this version carries no edit".
              delta
              ? [delta]
              : []
            : [{ text: content }],
      })
    }

    // A disk change IS a save as far as the server can tell — servers that only check on
    // save (rust-analyzer's `cargo check`, some linters) must hear it. An editor keystroke
    // is not: announcing didSave on every buffer sync made those servers start a full
    // check on every pause in typing, against disk bytes that did not hold the edit yet.
    // The editor announces its real saves through `saveDocument`.
    if (diskChanged) await sendDidSave(filePath, content)

    // Wait for the server to push back diagnostics. `true` means the server answered — by a
    // pull report or a push before the deadline; `false` means the deadline paid for nothing.
    const settleDiagnostics = async (): Promise<boolean> => {
      const remaining = DIAGNOSTICS_WAIT_TIMEOUT_MS - (Date.now() - startedAt)
      const pulled = await requestDiagnostics(filePath)
      if (pulled.handled) return true
      if (remaining > 0 && pushWait) return pushWait
      return false
    }
    if (waitForDiagnostics) return settleDiagnostics()
    void settleDiagnostics().catch(() => {})
    return true
  }

  /** Editor path: unblock hover/navigation after didOpen/didChange is dispatched.
   *  The buffer changed, not the file — no watched-file event. */
  async function syncDocument(filePath: string, content: string): Promise<void> {
    await syncDocumentInternal(filePath, content, false, false)
  }

  // The BODY rides along only if the server asked for it: `text` is spec'd as conditional
  // on `save.includeText`, so a server that did not declare it discards the copy while we
  // pay to serialize and ship the whole buffer a second time (didChange already carried it).
  async function sendDidSave(filePath: string, content: string): Promise<void> {
    await connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: fileUri(filePath) },
      ...(saveCarriesText ? { text: content } : {}),
    })
  }

  /** The editor wrote its buffer to disk: announce the save for an open document. */
  async function saveDocument(filePath: string): Promise<void> {
    const opened = openedFiles.get(filePath)
    if (isDisposed() || !opened) return
    await sendDidSave(filePath, opened.text).catch(() => {})
  }

  // Tell the server the editor closed the file: drop its open state and stale
  // diagnostics so a re-open re-syncs cleanly and counts don't leak.
  async function closeDocumentInternal(filePath: string, clearDiagnostics: boolean): Promise<void> {
    if (isDisposed() || !openedFiles.has(filePath)) return
    openedFiles.delete(filePath)
    if (clearDiagnostics) {
      pushDiagnostics.delete(filePath)
      pullDiagnostics.delete(filePath)
    }
    try {
      await connection.sendNotification('textDocument/didClose', {
        textDocument: { uri: fileUri(filePath) },
      })
    } catch {
      /* ignore — server may be gone */
    }
  }

  function closeDocument(filePath: string): Promise<void> {
    return closeDocumentInternal(filePath, true)
  }

  // Disk changes from the workspace watcher (see `lsp-watched-files.ts`). A file this client
  // holds OPEN is left out: its editor buffer is the server's truth (see `syncDocument`'s
  // `diskChanged`), and announcing it would make the server re-read a disk copy that may lack
  // the unsaved edit; the editor reloads it on `fs.changed` and resyncs through didChange.
  async function notifyWatchedFiles(changes: readonly LspWatchedFileChange[]): Promise<void> {
    if (isDisposed()) return
    const closed = changes.filter((change) => !openedFiles.has(change.path))
    if (!closed.length) return
    await connection.sendNotification('workspace/didChangeWatchedFiles', {
      changes: closed.map((c) => ({ uri: fileUri(c.path), type: WATCHED_CHANGE_CODE[c.type] })),
    })
  }

  return { touchFileAndWait, syncDocument, saveDocument, closeDocument, notifyWatchedFiles }
}
