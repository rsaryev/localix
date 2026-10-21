/**
 * A PLAN THE AGENT PRESENTED FOR THE PERSON TO REVIEW — the vocabulary.
 *
 * A plan is a document, not a tracker: goal, approach, steps, risks, open questions, written in
 * plan mode and handed to the person whole. Agreed work that needs order and ownership belongs
 * on the board; a plan that tracked progress would be a second copy of it.
 *
 * Every presentation is a new VERSION of the conversation's plan (1, 2, …), so a revision never
 * overwrites what the person commented on and the versions can be compared. A version's status
 * is the person's decision about it:
 *
 *   presented   waiting for the person; at most one per conversation — a newer one supersedes it;
 *   approved    the person approved it and chose the mode to implement in; at most one, and its
 *               body rides the system prompt of every later run (`approvedPlanSection`);
 *   superseded  replaced by a newer version, presented or approved;
 *   dismissed   the person put it aside, or the conversation left plan mode while it waited —
 *               nothing wakes;
 *   completed   the implementing agent declared the approved work done (`plan` action
 *               `complete`) — the end of the lifecycle, and the end of `approvedPlanSection`.
 *
 * Plans belong to the ROOT session: its permission mode is what an approval changes, and a
 * delegated child runs under it.
 */
import { z } from 'zod'
import { ALL_MENTION_HANDLE } from '@localixai/agent/agents'

import type { PermissionMode } from '../../contracts/permission-modes'
import { planSnapshotPath } from '../agent-core/plan-paths'
import { PLAN_BODY_MAX, PLAN_TITLE_MAX } from '../agent-core/plan-limits'

export const PLAN_STATUSES = [
  'presented',
  'approved',
  'superseded',
  'dismissed',
  'completed',
] as const
export type PlanStatus = (typeof PLAN_STATUSES)[number]

/**
 * Who set a version aside. Leaving Plan mode sets the waiting version aside on the person's
 * behalf; that one comes back by itself when the conversation returns to Plan mode, because
 * nobody decided against it. A version the person dismissed stays dismissed until they reopen it.
 */
export type PlanDismissedBy = 'person' | 'mode'

/** One version, as every client and the stream see it. */
export interface SessionPlan {
  id: string
  /** The root session the plan belongs to. */
  sessionId: string
  version: number
  status: PlanStatus
  title: string
  /** Markdown. */
  body: string
  /**
   * The participant that presented it — the one a review wakes. An approval names whoever the
   * person chose instead (this author by default, another participant, or everyone).
   */
  authorAgentId: string
  /** The mode the approval switched the conversation to. */
  approvedMode: PermissionMode | null
  createdAt: string
  decidedAt: string | null
  /** When the implementing agent declared the approved plan done, and its short report. */
  completedAt: string | null
  completionSummary: string | null
  /** Set while `dismissed`: who set it aside. */
  dismissedBy: PlanDismissedBy | null
  /** The version's snapshot file, `<plan dir>/v<N>.md` (`plan-paths.ts`). */
  filePath: string
}

/** The working draft, as the person's plan view and the agent's `read` see it. */
export interface PlanDraftState {
  /** `<plan dir>/PLAN.md`. */
  path: string
  exists: boolean
  /** The draft differs from the latest version: edited after it was presented, not yet shown. */
  changed: boolean
}

/** `GET /rpc/sessions/:id/plans` and the agent's `read`: every version, and the draft. */
export interface PlanOverview {
  plans: SessionPlan[]
  draft: PlanDraftState
}

/**
 * What one `present` did. `presented` is a new version; `restored` brought the latest version
 * back to review (it had been set aside, and the draft still says the same); `unchanged` found
 * that version already waiting, so nothing new was stored.
 */
export interface PlanPresentation {
  outcome: 'presented' | 'restored' | 'unchanged'
  plan: SessionPlan
}

/** The agent's `present`: the body is optional — without one, the draft file is presented. */
export interface PresentInput {
  title?: string
  body?: string
}

export interface PlanRecord extends Omit<SessionPlan, 'filePath'> {
  userId: string
  /** Review rounds sent so far. */
  reviewRound: number
}

/** The modes an approval may hand the conversation to: implementing in plan mode is not one. */
export const IMPLEMENTATION_MODES = [
  'default',
  'bypass',
  'autonomous',
] as const satisfies readonly Exclude<PermissionMode, 'plan'>[]
export type ImplementationMode = (typeof IMPLEMENTATION_MODES)[number]

export const planDraftSchema = z.object({
  title: z.string().trim().min(1).max(PLAN_TITLE_MAX),
  body: z.string().trim().min(1).max(PLAN_BODY_MAX),
})
export type PlanDraft = z.infer<typeof planDraftSchema>

export const planSessionParamsSchema = z.object({ id: z.string().min(1) })
export const planParamsSchema = z.object({ id: z.string().min(1), planId: z.string().min(1) })
/** Everyone in the conversation — the reserved address an approval may name instead of one. */
export const APPROVAL_TO_ALL = ALL_MENTION_HANDLE
export const approvePlanSchema = z.object({
  mode: z.enum(IMPLEMENTATION_MODES),
  /**
   * Who starts the work: a participant's handle, or `all`. Chosen from the conversation's own
   * roster rather than written as free text, so it cannot name someone who is not in it (the
   * service answers 400 for a handle that is not). Absent → the conversation's default answerer.
   */
  to: z.string().trim().min(1).max(200).optional(),
})
export const requestPlanChangesSchema = z.object({
  note: z.string().trim().max(10_000).optional(),
})

/**
 * Once-ever delivery keys. A re-sent approval or review round is then the SAME delivery, which
 * is what kept the old recovery continuation from answering one decision twice.
 */
export const planApprovedKey = (planId: string) => `plan:${planId}:approved`
export const planReviewKey = (planId: string, round: number) => `plan:${planId}:review:${round}`

/** A stored version as clients see it; `dir` is the conversation's plan directory. */
export function toSessionPlan(record: PlanRecord, dir: string): SessionPlan {
  const { userId: _owner, reviewRound: _round, ...plan } = record
  return { ...plan, filePath: planSnapshotPath(dir, record.version) }
}
