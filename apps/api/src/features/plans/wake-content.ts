/**
 * What the agent reads when the person decides on its plan — the content of the wake.
 *
 * Each carries the plan body itself. The version the agent presented may no longer be in its
 * view: a context checkpoint can have folded the turn that wrote it into a card, and an agent
 * told "implement v2" with only a card of v2 would reconstruct the plan from memory. The texts
 * name no tool either — the turn they open may hold a different roster than the one that wrote
 * the plan, and prompt text naming a tool the run lacks sends the model looking for it.
 */
import { PERMISSION_MODE_COPY } from '../../contracts/permission-modes'
import { anchorQuote, type CommentRecord } from '../comments/contracts'
import type { ImplementationMode, PlanRecord } from './contracts'

const QUOTE_MAX = 300

const planBlock = (plan: Pick<PlanRecord, 'version' | 'title' | 'body'>) =>
  `<plan version="${plan.version}" title=${JSON.stringify(plan.title)}>\n${plan.body}\n</plan>`

const clip = (text: string) =>
  text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1).trimEnd()}…` : text

export function planApprovedText(plan: PlanRecord, mode: ImplementationMode): string {
  return [
    `The user approved plan v${plan.version} (${JSON.stringify(plan.title)}) and switched this ` +
      `conversation to ${PERMISSION_MODE_COPY[mode].label} mode. Implement it now, following the ` +
      'plan below. Where the code turns out to disagree with the plan, say so and adapt.',
    planBlock(plan),
  ].join('\n\n')
}

/**
 * The person asked the agent to pick an approved plan up again after its work stopped. The
 * workspace, not the transcript, says how far it got — the turn that stopped may have been cut
 * mid-step — so the agent is told to check before it continues.
 */
export function planResumeText(plan: Pick<PlanRecord, 'version' | 'title' | 'body'>): string {
  return [
    `The user asks you to continue implementing the approved plan v${plan.version} ` +
      `(${JSON.stringify(plan.title)}). The work stopped before it was finished. First check ` +
      'what is already done in the workspace, then carry on with the remaining steps. When every ' +
      'step is done, mark the plan complete.',
    planBlock(plan),
  ].join('\n\n')
}

export function planReviewText(
  plan: PlanRecord,
  comments: readonly CommentRecord[],
  note: string | undefined,
): string {
  const lines = [
    `The user reviewed plan v${plan.version} (${JSON.stringify(plan.title)}) and asks for ` +
      'changes. Address every comment, then present the revised plan. Do not implement anything yet.',
  ]
  if (comments.length) {
    lines.push('', `Comments (${comments.length}):`)
    comments.forEach((comment, index) => {
      const quote = anchorQuote(comment.anchor)
      lines.push(
        quote
          ? `${index + 1}. On ${JSON.stringify(clip(quote))}:\n${comment.body}`
          : `${index + 1}. ${comment.body}`,
      )
    })
  }
  if (note) lines.push('', 'Note from the user:', note)
  lines.push('', planBlock(plan))
  return lines.join('\n')
}
