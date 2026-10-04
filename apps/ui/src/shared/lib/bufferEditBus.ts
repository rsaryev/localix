import type { BufferEdit } from '@localixai/api/lsp-edits'

/**
 * Language-server edits addressed to an editor's LIVE buffer (a quick fix, a rename) —
 * the counterpart of `fileReloadBus`, which announces files rewritten on disk.
 *
 * The server hands back edits for every document an editor holds open instead of writing
 * them to disk (`apps/api/src/features/lsp/edit-routing.ts`). Whoever asked — the editor's
 * own lightbulb, the Problems panel, a rename — may not be the editor that holds the file,
 * and a rename can touch several open files at once, so the edits are broadcast and each
 * editor takes the ones for its own file (`CodeEditor`). An editor applies an edit only when
 * its text still matches `digest`, and reports whether it did so the requester can tell the
 * person when nothing took the edit.
 */

type Listener = (edit: BufferEdit) => boolean

const listeners = new Set<Listener>()

/** Broadcast edits to the editors holding their files. Returns the files no editor applied. */
export function publishBufferEdits(edits: readonly BufferEdit[] | undefined): string[] {
  const unapplied: string[] = []
  for (const edit of edits ?? []) {
    let applied = false
    for (const listener of listeners) applied = listener(edit) || applied
    if (!applied) unapplied.push(edit.file)
  }
  return unapplied
}

/** Take edits for an editor's file; the listener answers whether it applied this one. */
export function onBufferEdits(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
