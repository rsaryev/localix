import type { EditorRenameResult } from '@/shared/ui/code-editor/CodeEditor'
import { publishBufferEdits } from '@/shared/lib/bufferEditBus'
import { publishFilesReloaded } from '@/shared/lib/fileReloadBus'
import { toast } from '@/shared/lib/notify'

export type LspEditVerb = 'Renamed' | 'Applied fix'

/**
 * Where a rename's or a quick fix's result goes once the server answers — one place, because
 * the editor's lightbulb, F2 and the Problems panel's quick fix all end the same way:
 *
 *   - edits for files an editor holds open go to those buffers (`bufferEditBus`), so the fix
 *     lands where the person is looking, undoable, without ever touching the dirty-vs-disk
 *     reconcile that used to raise "changed on disk" over their own fix;
 *   - files written to disk (nobody had them open) are announced so any view of them reloads.
 *
 * Answers how many files the edit changed, so a caller can say "made no changes".
 */
export function settleLspEdit(result: EditorRenameResult, verb: LspEditVerb): number {
  const bufferEdits = result.bufferEdits ?? []
  const unapplied = publishBufferEdits(bufferEdits)
  publishFilesReloaded(result.changedFiles)
  if (unapplied.length > 0) {
    // The buffer moved on between the request and the answer (typing while the menu was
    // open). Its edits were computed for text it no longer holds, so they were not spliced in.
    toast.warning(`${verb === 'Renamed' ? 'Rename' : 'Fix'} not applied — the file changed`, {
      description: 'The edit was computed for text that has since changed. Try it again.',
    })
  }
  const changed = result.changedFiles.length + bufferEdits.length - unapplied.length
  // One file is the one on screen, and the edit is visible where it was made; a row is kept
  // only when the change also reached files the person is not looking at.
  if (changed > 1) toast.success(`${verb} across ${changed} files`)
  return changed
}
