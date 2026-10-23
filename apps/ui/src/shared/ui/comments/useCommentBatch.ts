import { useCallback, useState } from 'react'
import type { CommentActionContribution } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'

import type { MessageAttachment } from '@/shared/api/contracts'
import { composerBus } from '@/shared/lib/composerBus'
import { useComments, type Comment } from '@localixai/mini-app-sdk/ui/comments'

/**
 * What a review-comment batch becomes — built once from the accumulated comments and read by
 * "Send" and by every contributed action alike.
 */
export interface CommentBatchPayload {
  /** Prompt sent to the agent on "Send to agent". */
  sendText: string
  /** Every comment as markdown, its target line quoted — a contributed action's `summary`. */
  summary: string
  /** Workspace paths the batch points at. */
  files: string[]
  /** Optional asset bindings (e.g. element screenshots) sent with the message. */
  bindings?: MessageAttachment[]
}

export interface UseCommentBatchOptions {
  sessionId: string | null
  /** Comment-store scope cleared after a successful action (e.g. a session id). */
  scope: string | null
  /** The scope's comments (already filtered). */
  comments: Comment[]
  buildPayload: (comments: Comment[]) => CommentBatchPayload
  /** A short title for the batch, derived from what the comments are about. */
  title: (files: string[], comments: Comment[]) => string
  /** Optional pre-action step (e.g. save a dirty file) run before any action. */
  beforeAct?: () => Promise<void>
  toasts?: { sendError?: string }
}

export interface CommentBatchActions {
  sending: boolean
  /** The id of the contributed action in flight, if any. */
  runningAction: string | null
  submit: () => Promise<void>
  runAction: (action: CommentActionContribution) => Promise<void>
}

/**
 * Surface-agnostic "accumulate → act" flow for review comments, so every surface that collects
 * comments sends them the same way and hands them to the same contributed actions
 * (`host.commentActions`). The comments are cleared only after the action RESOLVED: clearing on
 * click would throw away a person's review when the destination refused it. Pair with
 * {@link useComments} + `CommentsManager`.
 */
export function useCommentBatch(opts: UseCommentBatchOptions): CommentBatchActions {
  const clearScope = useComments((s) => s.clearScope)
  const [sending, setSending] = useState(false)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const { sessionId, scope, comments, buildPayload, title, beforeAct, toasts } = opts

  // "Submit" prefills the chat composer (visible + editable) — the user reviews and
  // sends. Reuses the agnostic composerBus so every surface behaves identically.
  const submit = useCallback(async () => {
    if (!sessionId || !scope || comments.length === 0) return
    setSending(true)
    try {
      await beforeAct?.()
      const { sendText, bindings } = buildPayload(comments)
      composerBus.insert({ sessionId, text: sendText, bindings })
      // No success row: the comments appear in the composer, which is where the person looks next.
      clearScope(scope)
    } catch (e) {
      toast.error(toasts?.sendError ?? 'Could not add the comments', {
        description: errorMessage(e, '') || undefined,
      })
    } finally {
      setSending(false)
    }
  }, [sessionId, scope, comments, buildPayload, beforeAct, clearScope, toasts])

  // The contract says the action resolves with a sentence to confirm and rejects with one to
  // report, so the host speaks for it either way — an action that toasted for itself would read
  // differently from every other, and one that did not would leave the person guessing.
  const runAction = useCallback(
    async (action: CommentActionContribution) => {
      if (!sessionId || !scope || comments.length === 0) return
      setRunningAction(action.id)
      try {
        await beforeAct?.()
        const { summary, files } = buildPayload(comments)
        const result = await action.run({
          sessionId,
          title: title(files, comments),
          summary,
          files,
        })
        clearScope(scope)
        if (result?.message) toast.success(result.message)
      } catch (e) {
        toast.error(errorMessage(e, `${action.label} did not complete`))
      } finally {
        setRunningAction(null)
      }
    },
    [sessionId, scope, comments, buildPayload, title, beforeAct, clearScope],
  )

  return { sending, runningAction, submit, runAction }
}
