import { useCallback } from 'react'
import {
  useComments,
  useScopeComments,
  type CommentAnchor,
} from '@localixai/plugin-sdk/ui/comments'
import { composerBus } from '@/shared/lib/composerBus'
import type { MessageAttachment } from '@/shared/api/contracts'
import { reviewCommentBinding, reviewCommentToken } from '@/shared/lib/reviewCommentBinding'

/**
 * A review comment, on any surface, in one mechanism.
 *
 * Two things used to be true of every review surface independently: it kept a list of what the
 * person marked, and it invented its own way of getting that list to the model. The preview
 * mirrored its list into a floating popover the composer's own context row already showed; the
 * plan kept a private store whose comments reached the model ONLY through the plan band's
 * one-click accept, and were silently dropped by an ordinary send.
 *
 * Here a comment IS a staged context binding. The store keeps the ANCHOR (what the surface
 * highlights in place); the composer keeps the CONTEXT (what the message carries), and the two
 * are written together, so removing a comment where it was made also takes back what it
 * attached. A new surface — a doc, a diff, an image — needs only an anchor and a content
 * builder, not a delivery path of its own.
 */
export interface ReviewCommentInput {
  anchor: CommentAnchor
  /** The person's note, and what the chip reads as. */
  body: string
  label: string
  /** Model-facing text: what was reviewed, and the note about it. */
  content: string
  /** Nested evidence budgeted with the binding (a screenshot of the picked element). */
  assets?: MessageAttachment[]
}

export interface ReviewComments {
  comments: ReturnType<typeof useScopeComments>
  /** Record one observation: stored for the surface, staged for the message. */
  add: (input: ReviewCommentInput) => string
  /** Refresh an existing comment's staged context in place (an edited note). */
  restage: (id: string, input: Omit<ReviewCommentInput, 'anchor'>) => void
  /** Drop one: unstages its context as well. */
  remove: (id: string) => void
  /** Drop the scope's whole batch, staged context included. */
  clear: () => void
  /** The composer tokens this scope currently holds — what a non-composer send must carry. */
  tokens: () => string[]
}

/**
 * `scope` groups a surface's batch: `preview:<sessionId>:<origin>`, …
 *
 * `sessionId` is the chat whose composer carries the batch — the one the reviewed surface belongs
 * to. It is never filled in from the focused composer: that put a comment made in chat A's tab
 * into chat B's draft. A surface with no chat has no message for its comments to ride, so they
 * are kept where they were made and staged nowhere.
 */
export function useReviewComments(scope: string, sessionId: string | null): ReviewComments {
  const comments = useScopeComments(scope)
  const addComment = useComments((s) => s.add)
  const removeComment = useComments((s) => s.remove)
  const clearScope = useComments((s) => s.clearScope)

  const add = useCallback(
    (input: ReviewCommentInput) => {
      const id = addComment(scope, input.anchor, input.body)
      if (!sessionId) return id
      composerBus.insert({
        sessionId,
        // The person is reading the thing they commented on; the composer takes the context
        // without taking the cursor.
        buffer: true,
        focus: false,
        bindings: [
          reviewCommentBinding({
            token: id,
            label: input.label,
            content: input.content,
            ...(input.assets?.length ? { assets: input.assets } : {}),
          }),
        ],
      })
      return id
    },
    [addComment, scope, sessionId],
  )

  const restage = useCallback(
    (id: string, input: Omit<ReviewCommentInput, 'anchor'>) => {
      if (!sessionId) return
      composerBus.insert({
        sessionId,
        buffer: true,
        focus: false,
        bindings: [
          reviewCommentBinding({
            token: id,
            label: input.label,
            content: input.content,
            ...(input.assets?.length ? { assets: input.assets } : {}),
          }),
        ],
      })
    },
    [sessionId],
  )

  const remove = useCallback(
    (id: string) => {
      removeComment(id)
      if (sessionId) composerBus.retract({ sessionId, tokens: [reviewCommentToken(id)] })
    },
    [removeComment, sessionId],
  )

  const clear = useCallback(() => {
    const tokens = useComments
      .getState()
      .comments.filter((c) => c.scope === scope)
      .map((c) => reviewCommentToken(c.id))
    clearScope(scope)
    if (sessionId) composerBus.retract({ sessionId, tokens })
  }, [clearScope, scope, sessionId])

  const tokens = useCallback(
    () =>
      useComments
        .getState()
        .comments.filter((c) => c.scope === scope)
        .map((c) => reviewCommentToken(c.id)),
    [scope],
  )

  return { comments, add, restage, remove, clear, tokens }
}
