/**
 * WHAT HAPPENS TO A COMMENT WHEN THE PLAN IT WAS WRITTEN ON IS REPLACED.
 *
 * Comments are kept per version (`plan:<planId>`). When the agent presents a new version, the
 * comments the person wrote on the old one and never sent used to be left behind: still `open`,
 * attached to a version nobody looks at, highlighting nothing — a review that silently vanished.
 *
 * So each still-open comment of the previous version is decided once against the new body:
 *
 *   carry     its sentence is still in the new version — it moves there and stays sendable;
 *   outdated  its sentence is gone — it is marked `outdated` and listed as such, never dropped.
 *
 * Comments already `sent` were delivered with a review and are history; they are not touched.
 */
import type { CommentView } from '@localixai/api/client'

/** The quoted sentence a plan comment's anchor carries. */
export function commentQuote(comment: Pick<CommentView, 'anchor'>): string {
  const quote = comment.anchor.quote
  return typeof quote === 'string' ? quote : ''
}

/**
 * The text a reader sees, from markdown source, for matching a quote taken from the RENDERED
 * page: link targets and emphasis/code/heading/quote/table marks removed, whitespace collapsed.
 * A heuristic on purpose — a false "gone" makes a comment outdated (still listed), never lost.
 */
export function visibleText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function quoteStillPresent(quote: string, markdown: string): boolean {
  const needle = visibleText(quote)
  return needle.length > 0 && visibleText(markdown).includes(needle)
}

export interface CarryDecision {
  carry: CommentView[]
  outdated: CommentView[]
}

/** Decide every still-open comment of the previous version against the new version's body. */
export function decideCarryOver(
  previousComments: readonly CommentView[],
  nextBody: string,
): CarryDecision {
  const decision: CarryDecision = { carry: [], outdated: [] }
  for (const comment of previousComments) {
    if (comment.status !== 'open') continue
    if (quoteStillPresent(commentQuote(comment), nextBody)) decision.carry.push(comment)
    else decision.outdated.push(comment)
  }
  return decision
}
