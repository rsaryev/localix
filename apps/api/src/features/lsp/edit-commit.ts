import { createHash } from 'node:crypto'
import { createTwoFilesPatch } from 'diff'
import { applyTextEdits } from './lsp-edits'
import type { LspTextEdit, LspWorkspaceEditFile } from './lsp-protocol'
import type { RenameResult } from './service'

/**
 * How an LSP edit becomes durable bytes.
 *
 * Every server-side write the language server asks for — a rename, a code
 * action, a format — lands here, because they all have to satisfy the same
 * non-obvious contract and used to each re-derive it:
 *
 *   read current → hash THAT EXACT READ → applyTextEdits → write with that hash
 *
 * The hash is an OPTIMISTIC-CONCURRENCY baseline: the editor's write path rejects
 * the write if the file on disk no longer matches it. So the baseline must be the
 * content we just read and computed `next` from — never a re-read, which would
 * paper over exactly the concurrent modification the check exists to catch.
 *
 * `formatDocument` used to spell this loop out a second time, inline. Two copies
 * of an invariant is one copy too many when the invariant is "do not silently
 * clobber the user's concurrent edit".
 */

/** The editor's locked, concurrency-checked write path (same one file-save uses). */
export type LspWriteFile = (
  userId: string,
  sessionId: string,
  file: string,
  content: string,
  baseHash: string,
) => Promise<{ hash: string }>

const contentHash = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex')

/** A file that was actually rewritten, with both sides still in hand. */
interface CommittedFile {
  file: string
  before: string
  after: string
}

export interface LspEditCommitter {
  /**
   * Apply `edits` to one file and commit. Returns null when the file is
   * unreadable (gone since the server saw it) or the edits are a no-op — both
   * are ordinary outcomes, not errors.
   */
  commitFile(
    userId: string,
    sessionId: string,
    file: string,
    edits: LspTextEdit[],
  ): Promise<CommittedFile | null>
  /**
   * Commit a flattened multi-file WorkspaceEdit; unreadable/no-op files are skipped.
   *
   * Each file is committed INDEPENDENTLY: one failure does not block the others, and the result
   * names what failed. It used to abort the loop on the first throw, which lost the list of files
   * already written — the workspace was left half-renamed with nothing to say which half.
   */
  commitWorkspaceEdit: (
    userId: string,
    sessionId: string,
    fileEdits: LspWorkspaceEditFile[],
  ) => Promise<RenameResult>
}

export function createLspEditCommitter(writeFile: LspWriteFile): LspEditCommitter {
  async function commitFile(
    userId: string,
    sessionId: string,
    file: string,
    edits: LspTextEdit[],
  ): Promise<CommittedFile | null> {
    let before: string
    try {
      before = await Bun.file(file).text()
    } catch {
      return null // file gone / unreadable
    }
    const after = applyTextEdits(before, edits)
    if (after === before) return null
    await writeFile(userId, sessionId, file, after, contentHash(before))
    return { file, before, after }
  }

  return {
    commitFile,

    commitWorkspaceEdit: async (userId, sessionId, fileEdits) => {
      const changedFiles: string[] = []
      const files: { file: string; content: string; diff: string }[] = []
      const failed: { file: string; reason: string }[] = []
      for (const fe of fileEdits) {
        // `fe.file` is already an absolute path (normalizeWorkspaceEdit → fileURLToPath).
        let committed: CommittedFile | null
        try {
          committed = await commitFile(userId, sessionId, fe.file, fe.edits)
        } catch (error) {
          // A write can fail for ordinary reasons — most commonly the optimistic-concurrency hash,
          // i.e. the user edited that file in the editor while this ran. Letting it escape here
          // discarded every file already committed, so the caller could not report the split.
          failed.push({
            file: fe.file,
            reason: error instanceof Error ? error.message : 'write failed',
          })
          continue
        }
        if (!committed) continue
        changedFiles.push(committed.file)
        // Unified diff from the before/after we already hold — lets a caller (the
        // rename_symbol tool card) render the change without re-reading either side.
        files.push({
          file: committed.file,
          content: committed.after,
          diff: createTwoFilesPatch(
            committed.file,
            committed.file,
            committed.before,
            committed.after,
          ),
        })
      }
      return { changedFiles, files, ...(failed.length > 0 ? { failed } : {}) }
    },
  }
}
