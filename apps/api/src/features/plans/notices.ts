/**
 * WHAT EACH STEP OF A PLAN SAYS IN THE CONVERSATION — one line per transition, one table.
 *
 * Before these lines existed a plan's decisions reached only the agent that presented it, as the
 * wake that opened its next turn. The person had a card that changed colour and nothing in the
 * transcript; every other participant had nothing at all, so a reviewer agent went on critiquing
 * a version the person had already approved. Each line is a `StoredSystemNotice`: the person
 * reads it in the transcript and every participant reads it as the conversation's current plan
 * step (`system-notice-bindings.ts` keys every plan kind to ONE slot, so the newest step wins).
 *
 * The texts live together so that the lifecycle reads as one sentence per stage, and so that a
 * new stage cannot be announced in a voice of its own.
 */
import type { StoredSystemNotice } from '../../db/payload'
import { PERMISSION_MODE_COPY } from '../capabilities/permission-modes'
import type { ImplementationMode, SessionPlan } from './contracts'

type Plan = Pick<SessionPlan, 'version' | 'title'>

/** Whom an approval handed the work to: one participant, or everyone. */
export type ApprovalAddressee = { handle: string } | { all: true }

/** A summary's first line, bounded — the notice is one line in the transcript. */
const LINE_MAX = 200
const firstLine = (text: string): string => {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1).trimEnd()}…` : line
}

export const planNotice = {
  presented: (plan: Plan, handle: string | null): StoredSystemNotice => ({
    kind: 'plan_presented',
    tone: 'info',
    text: handle
      ? `${handle} presented plan v${plan.version}: ${plan.title}.`
      : `Plan v${plan.version} presented: ${plan.title}.`,
  }),

  /** A version set aside earlier is under review again — the same number, the same text. Its
   *  kind is `plan_presented`: for every reader it is the plan now waiting on the person. */
  restored: (plan: Plan): StoredSystemNotice => ({
    kind: 'plan_presented',
    tone: 'info',
    text: `Plan v${plan.version} is back for review.`,
  }),

  changesRequested: (plan: Plan, comments: number): StoredSystemNotice => ({
    kind: 'plan_changes_requested',
    tone: 'neutral',
    text:
      comments > 0
        ? `Changes requested on plan v${plan.version} (${comments} comment${comments === 1 ? '' : 's'}).`
        : `Changes requested on plan v${plan.version}.`,
  }),

  /**
   * Who starts rides the line when the person chose among several. The wake reaches only that
   * addressee, so without it every other participant — and the person scrolling back — would
   * see an approval and not know whose turn the work now is. A one-agent chat (or no choice)
   * passes `null`: naming the only agent says nothing.
   */
  approved: (
    plan: Plan,
    mode: ImplementationMode,
    addressee: ApprovalAddressee | null,
  ): StoredSystemNotice => ({
    kind: 'plan_approved',
    tone: 'success',
    text:
      `Plan v${plan.version} approved — ${PERMISSION_MODE_COPY[mode].label} mode.` +
      (!addressee ? '' : 'all' in addressee ? ' Everyone starts.' : ` ${addressee.handle} starts.`),
  }),

  dismissed: (plan: Plan): StoredSystemNotice => ({
    kind: 'plan_dismissed',
    tone: 'neutral',
    text: `Plan v${plan.version} set aside.`,
  }),

  /** The conversation left plan mode while the version waited: nobody approved it. */
  leftPlanMode: (plan: Plan): StoredSystemNotice => ({
    kind: 'plan_dismissed',
    tone: 'neutral',
    text: `Plan v${plan.version} set aside: the conversation left Plan mode without approving it.`,
  }),

  /** The person asked the agent to pick the approved plan up again (`resume-point.ts`). */
  resumed: (plan: Plan): StoredSystemNotice => ({
    kind: 'plan_resumed',
    tone: 'info',
    text: `Plan v${plan.version} continued.`,
  }),

  completed: (plan: Plan, summary: string): StoredSystemNotice => ({
    kind: 'plan_completed',
    tone: 'success',
    text: `Plan v${plan.version} completed: ${firstLine(summary)}`,
  }),
}
