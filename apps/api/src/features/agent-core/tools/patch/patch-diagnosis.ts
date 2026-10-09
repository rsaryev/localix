import { errorMessage } from '../../../../lib/errors'
import type { FileMtimeStore } from '../file/file-utils'

/**
 * A context-match failure on a file this session never READ means the patch's context
 * lines were recalled, not copied. Measured on the recorded corpus: 13 of the 65
 * "Failed to locate the context" failures patched a file the agent had never read.
 * The generic message ("watch indentation … retry with exact whole-line context") sends
 * the model to fiddle with whitespace on lines it invented, so it retries and fails
 * again. Name the real cause instead. The mtime store is the session's record of every
 * file a tool read or wrote, so `!has(path)` is exactly "unseen".
 *
 * A second cause wears the same "unseen" disguise: the session read the file, then the
 * USER edited it (invalidateFileMtime dropped the record so the guards stay honest).
 * `wasInvalidated(path)` tells the two apart — that one gets "the user may have edited
 * the file", not "you never read it".
 */
export function unreadFileDiagnosis(error: unknown, path: string, mtimes: FileMtimeStore): string {
  const message = errorMessage(error)
  if (!/Failed to locate the context/.test(message)) return ''
  // The session DID read the file, but it then changed by a route no agent tool
  // observed (the user saving it in the editor, most of all) — the mtime record
  // was dropped by `invalidateFileMtime`, so the stale guard let matching run
  // against the CURRENT disk content and it missed. Name the real cause: the
  // context lines are from a version that no longer exists, not a typo to fix.
  if (mtimes.wasInvalidated(path)) {
    const cause = `\n\n${path} was modified outside this session after you last read it — the user may have edited the file since you read it, so your context lines may describe a version that no longer exists.`
    // Only claim "the lines above are current" when the error actually printed them.
    return /\nActual lines |\nThe full file \(/.test(message)
      ? `${cause} The file lines printed above are the CURRENT content — rebuild your hunk from them, not from memory.`
      : `${cause} Read it again, then re-issue the patch.`
  }
  if (mtimes.has(path)) return ''
  const cause = `\n\nYou have not read ${path} with the \`read\` tool in this session, so the context lines above came from memory, not from the file.`
  // A small file is printed IN the error. Telling the model to read it there would
  // contradict the same error's "no re-read needed" and cost a pointless turn.
  return /\nThe full file \(/.test(message)
    ? `${cause} Use the real lines printed above.`
    : `${cause} Read it first, then patch it.`
}
