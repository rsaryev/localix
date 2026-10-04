import { applyTextEdits, textDigest, type BufferEdit } from './lsp-edits'
import type { LspWorkspaceEditFile } from './lsp-protocol'
import type { RenameResult } from './service'

/**
 * Where one language-server WorkspaceEdit lands, file by file.
 *
 * The server computes every range against the document it was last sent. For a file an
 * editor holds open that document IS the editor's unsaved buffer, so its edits go back to
 * that buffer (`bufferEdits`); writing them to disk spliced buffer ranges into older disk
 * bytes and made the editor raise "changed on disk" over its own quick fix. A file nobody
 * holds open has no buffer to disagree with, so it is committed to disk as before.
 */

/** The text of `file` as the language server last received it from an open editor, if any. */
export type OpenBufferText = (file: string) => string | undefined

/** Commits the files no editor holds (`edit-commit.ts`'s `commitWorkspaceEdit`). */
export type CommitToDisk = (fileEdits: LspWorkspaceEditFile[]) => Promise<RenameResult>

/**
 * The buffer edit for one open file, or null when the edits would not change its text —
 * a no-op fix must read as "made no changes", not as a buffer write.
 */
export function bufferEditFor(
  file: string,
  text: string,
  edits: LspWorkspaceEditFile['edits'],
): BufferEdit | null {
  if (edits.length === 0 || applyTextEdits(text, edits) === text) return null
  return { file, digest: textDigest(text), edits }
}

export async function routeWorkspaceEdit(
  fileEdits: LspWorkspaceEditFile[],
  openBufferText: OpenBufferText,
  commitToDisk: CommitToDisk,
): Promise<RenameResult> {
  const bufferEdits: BufferEdit[] = []
  const diskEdits: LspWorkspaceEditFile[] = []
  for (const fileEdit of fileEdits) {
    const text = openBufferText(fileEdit.file)
    if (text === undefined) {
      diskEdits.push(fileEdit)
      continue
    }
    const edit = bufferEditFor(fileEdit.file, text, fileEdit.edits)
    if (edit) bufferEdits.push(edit)
  }
  const committed =
    diskEdits.length > 0 ? await commitToDisk(diskEdits) : { changedFiles: [], files: [] }
  return bufferEdits.length > 0 ? { ...committed, bufferEdits } : committed
}
