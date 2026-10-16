import { useCallback, useMemo } from 'react'
import { toast } from '@/shared/lib/notify'
import { composerBus } from '@/shared/lib/composerBus'
import { openFileInGrid } from '@/features/inspector/model/fileNav'
import type { EditorDiagnostic, EditorSelectionRange } from '@/shared/ui/code-editor/CodeEditor'
import { useCommentBatch } from '@/shared/ui/comments/useCommentBatch'
import { useComments, useScopeComments, type Comment } from '@localixai/plugin-sdk/ui/comments'
import { baseName, errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { buildCommentsPayload, saveBeforeFileAction } from './fileTabHelpers'
import { buildFixRequest } from '../model/fixRequest'

interface FileCommentsOptions {
  /** The chat the file tab belongs to — comments, fixes and jumps all address it. */
  sessionId: string
  /** Resolved absolute path of the open file (comment anchor target). */
  editPath: string | null | undefined
  /** Display path (for group labels). */
  path: string
  /** Current editor buffer — read for the "Fix" line snippet. */
  buffer: string
  /** Whether the buffer has unsaved edits — saved before acting so the agent reads it. */
  dirty: boolean
  save: () => Promise<boolean> | boolean
  /** The file's language — the fence of the "Fix" request's code window. */
  language: string
  /** The file's current diagnostics — neighbours of a fixed one ride along in its request. */
  diagnostics: readonly EditorDiagnostic[]
}

/**
 * Review-comment surface for {@link FileTab}. Wraps the standardized session-scoped
 * comment store (shared/lib/comments) + comment-batch flow: highlighted ranges in the
 * open file, adding a comment (from a selection or a diagnostic "Fix"), navigating to a
 * comment's target, and the send-to-agent / contributed batch actions.
 */
export function useFileComments({
  sessionId,
  editPath,
  path,
  buffer,
  dirty,
  save,
  language,
  diagnostics,
}: FileCommentsOptions) {
  // Standardized review comments (shared/lib/comments) — scoped to this file tab's session
  // so a batch spans multiple files. The same store/UI backs prose and website surfaces.
  const sessionComments = useScopeComments(sessionId)
  const addComment = useComments((s) => s.add)
  const setCommentBody = useComments((s) => s.setBody)
  const removeComment = useComments((s) => s.remove)
  const clearScope = useComments((s) => s.clearScope)

  // Ranges in THIS file that already carry a comment → highlighted in the editor.
  const commentRanges = useMemo(
    () =>
      sessionComments.flatMap((c) =>
        c.anchor.targetId === editPath
          ? [
              {
                line: Number(c.anchor.locator?.line ?? 0),
                endLine: Number(c.anchor.locator?.endLine ?? c.anchor.locator?.line ?? 0),
                id: c.id,
                body: c.body,
              },
            ]
          : [],
      ),
    [sessionComments, editPath],
  )

  // Add a review comment (from a selection or an error "Fix") to the session batch,
  // anchored to this file + line range (standardized model in shared/lib/comments).
  const pushComment = useCallback(
    (line: number, endLine: number, snippet: string, body: string) => {
      if (!sessionId || !editPath) return
      // Store the FULL first line (the popover CSS-truncates; the batch summary quotes
      // it whole, syntax-highlighted). Cap only to avoid an absurdly long minified line.
      const firstLine = (snippet.split('\n')[0]?.trim() ?? '').slice(0, 400)
      addComment(
        sessionId,
        {
          kind: 'file',
          targetId: editPath,
          label: line === endLine ? `Line ${line + 1}` : `Lines ${line + 1}–${endLine + 1}`,
          groupId: editPath,
          groupLabel: baseName(path),
          context: firstLine,
          locator: { line, endLine },
        },
        body,
      )
    },
    [sessionId, editPath, path, addComment],
  )

  const onAddComment = useCallback(
    (sel: EditorSelectionRange, body: string) => pushComment(sel.line, sel.endLine, sel.text, body),
    [pushComment],
  )

  // Quick Fix → Fix with Agent sends a visible turn through THIS file's session's
  // normal composer path. A running turn queues it; saving first keeps the agent's
  // workspace view aligned with the diagnostic and current editor buffer.
  const requestFix = useCallback(
    (d: EditorDiagnostic) => {
      const text = buildFixRequest({
        diagnostic: d,
        path: editPath || path,
        text: buffer,
        language,
        diagnostics,
      })
      void saveBeforeFileAction(dirty, save)
        .then((saved) => {
          if (!saved) return
          composerBus.insert({
            text,
            sessionId,
            replace: true,
            submit: true,
            buffer: true,
          })
          // No success row: the request appears in this session's transcript as it is sent.
        })
        .catch((cause: unknown) => {
          toast.error('Could not start the fix in this conversation', {
            description: errorMessage(cause, '') || undefined,
          })
        })
    },
    [buffer, dirty, path, editPath, language, diagnostics, save, sessionId],
  )

  // Open a comment's target file at its line (cross-file management).
  const navigateToComment = useCallback(
    (c: Comment) => {
      openFileInGrid({
        sessionId,
        path: c.anchor.targetId,
        line: Number(c.anchor.locator?.line ?? 0) + 1,
      })
    },
    [sessionId],
  )

  // Send-to-agent and every contributed comment action reuse the shared comment-batch
  // flow. Save first so whoever reads the batch reads the same content the comments
  // refer to.
  const {
    sending: sendingComments,
    runningAction: runningCommentAction,
    submit: sendComments,
    runAction: runCommentAction,
  } = useCommentBatch({
    sessionId,
    scope: sessionId,
    comments: sessionComments,
    beforeAct: async () => {
      if (!(await saveBeforeFileAction(dirty, save))) throw new Error('Save failed')
    },
    buildPayload: (cs) => {
      const { summary, files } = buildCommentsPayload(cs)
      // The full comment text goes straight into the composer — visible and editable.
      return {
        sendText: `Please address these review comments:\n\n${summary}`,
        summary,
        files,
      }
    },
    title: (files, cs) =>
      files.length === 1
        ? `Review ${baseName(files[0])}`
        : `Review ${cs.length} comments (${files.length} files)`,
  })

  const clearComments = useCallback(() => {
    if (sessionId) clearScope(sessionId)
  }, [sessionId, clearScope])

  return {
    sessionComments,
    commentRanges,
    onAddComment,
    requestFix,
    navigateToComment,
    setCommentBody,
    removeComment,
    clearComments,
    sendingComments,
    runningCommentAction,
    sendComments,
    runCommentAction,
  }
}
