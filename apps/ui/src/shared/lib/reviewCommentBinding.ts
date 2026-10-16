import { snippetMessageBindingDraft } from '@localixai/plugin-sdk/ui'
import { useComments } from '@localixai/plugin-sdk/ui/comments'
import type { MessageAttachment } from '@/shared/api/contracts'

/** Every review binding is a snippet, and its token IS its comment's id. */
const PREFIX = '@snippet:'

/**
 * One review observation, expressed the only way review evidence travels: an immutable
 * context binding staged in the composer.
 *
 * Every review surface — a pick in the live preview, a sentence commented on a plan — used to
 * keep its own retained list and its own way out. The preview grew a floating "N comments"
 * popover to manage a list the composer was already showing as chips, and the plan's comments
 * reached the model only if you happened to accept the plan band, silently doing nothing on an
 * ordinary send. One binding per observation replaces both: the composer's context row is where
 * you see it, budget it and remove it, and any message carries it.
 *
 * `token` is the identity. Re-staging the same one REPLACES the chip (an edited note refreshes
 * in place); retracting it removes it (see `composerBus.retract`).
 */
export function reviewCommentBinding(input: {
  /** Stable within its surface — `preview-<id>`. Becomes `@snippet:<token>`. */
  token: string
  /** What the chip reads as. */
  label: string
  /** The model-facing text: what was reviewed, and the person's note about it. */
  content: string
  /** Nested evidence (a screenshot of the picked element) budgeted with the binding. */
  assets?: MessageAttachment[]
}) {
  const binding = snippetMessageBindingDraft({
    label: input.label,
    content: input.content,
    language: 'markdown',
  })
  return {
    ...binding,
    ...(input.assets?.length ? { assets: input.assets } : {}),
    // Two observations of the same element must survive as independent captures, so the
    // token carries the observation's id rather than the label's text.
    target: { ...binding.target, token: `${PREFIX}${input.token}` },
  }
}

/** The composer key a staged review binding is retracted by. */
export function reviewCommentToken(token: string): string {
  return `${PREFIX}${token}`
}

/**
 * Forget every comment the given tokens belong to — the other half of the cycle.
 *
 * A comment exists to be delivered. Once its context has ridden out with a message, the mark it
 * left on a commented sentence or the preview element is describing feedback that has already been
 * given: leaving it there invites the same note twice, and makes a page look unreviewed-but-
 * marked forever. The composer knows exactly which tokens went, so it says so here.
 */
export function forgetSubmittedReviewComments(tokens: readonly string[]): void {
  if (tokens.length === 0) return
  const ids = new Set(
    tokens.filter((token) => token.startsWith(PREFIX)).map((token) => token.slice(PREFIX.length)),
  )
  if (ids.size === 0) return
  const { comments, remove } = useComments.getState()
  for (const comment of comments) if (ids.has(comment.id)) remove(comment.id)
}
