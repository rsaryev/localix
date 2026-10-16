import { createTwoFilesPatch } from 'diff'

/**
 * What the model is told when a file it reads or writes is open in the person's editor with
 * UNSAVED edits — the text on disk and the text on screen disagree.
 *
 * The file tools only ever see disk. So the agent read a file without the lines the person had
 * just typed, and wrote over a file whose open tab then raised "changed on disk" — the person
 * had to reconcile two versions of an edit neither side knew about. The editor's buffer is
 * already on the server (the LSP document service syncs it on every pause), so the tool result
 * can say so, at no schema cost: no tool, no parameter, only a note when it applies — the same
 * shape as the `<lsp_diagnostics>` block a write already carries.
 */

/** Diff lines shown at most — enough to see what they are in the middle of, not a second file. */
const MAX_DIFF_LINES = 40

export type EditorBufferMoment = 'read' | 'write'

export function editorBufferNote(
  path: string,
  diskText: string,
  bufferText: string | undefined,
  moment: EditorBufferMoment,
): string {
  if (bufferText === undefined || bufferText === diskText) return ''
  const body = createTwoFilesPatch('disk', 'editor', diskText, bufferText, '', '', { context: 1 })
    .split('\n')
    // Drop the `Index:`/`===`/`---`/`+++` header; the hunks are the information.
    .filter((line, index) => index > 3 || line.startsWith('@@'))
  const shown = body.slice(0, MAX_DIFF_LINES)
  const clipped =
    body.length > shown.length ? `\n… ${body.length - shown.length} more diff lines` : ''
  const lead =
    moment === 'read'
      ? `${path} is open in the person's editor with UNSAVED edits. The text above is the file on disk and does not include them. Their unsaved changes (disk → editor):`
      : `${path} is open in the person's editor with UNSAVED edits that your change did not include — the editor will ask them to reconcile the two versions. Their unsaved changes (disk before your change → editor):`
  return `<editor_buffer>\n${lead}\n\`\`\`diff\n${shown.join('\n').trimEnd()}${clipped}\n\`\`\`\n</editor_buffer>`
}
