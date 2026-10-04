/**
 * THE PLAN'S LIFECYCLE — the agent presents a version; the person approves it, asks for changes,
 * or puts it aside; the agent implements it and declares it done. Each step reaches the agent
 * exactly once, and each says so exactly once in the conversation.
 *
 * The old plan feature's failures shape every operation here:
 *
 *   - a decision was carried by a recovery continuation that could fire twice, so the agent got
 *     two "approved" messages. A decision is now ONE wake with a once-ever delivery key
 *     (`planApprovedKey`, `planReviewKey`) through the same delivery every producer uses;
 *   - review comments lived in the browser and were lost unless one button carried them. They
 *     are rows (`features/comments`), taken and marked `sent` in one statement when a review is
 *     sent, and put back to `open` if its wake could not be delivered — so a comment the person
 *     wrote is either with the agent or still on the plan, never in neither;
 *   - the model was asked to switch modes itself and stalled. The PERSON's approval switches the
 *     conversation out of plan mode, through the session update path every mode change takes;
 *   - a step was visible only to the agent it woke. Every transition now writes ONE conversation
 *     line (`notices.ts`) and moves ONE attention item (the person's "waiting on you" list and
 *     its journal row) through the injected `lifecycle` port;
 *   - the plan was only the `present` argument, so a version set aside could not come back and
 *     was re-typed as a new one. It is a file now, and presenting and restoring it is
 *     `service-present.ts`;
 *   - an approval could only wake the author, so the person could not hand the plan to the
 *     colleague who should build it. An approval now names who starts — the author, another
 *     participant, or everyone — and is routed as the conversation routes that address —
 *     `service-approve.ts`.
 *
 * Each operation reads in one order: validate the version and its state → decide (one guarded
 * write) → publish → say it (notice, attention) → reach the agent.
 */
import { ApiError } from '../../lib/errors'
import { agentParticipant } from '../../db/participant'
import type { StoredSystemNotice } from '../../db/payload'
import type { PermissionMode } from '../capabilities/permission-modes'
import type { WakeRequest } from '../chat/contracts'
import type { WakeOutcome } from '../triggers/delivery'
import type { CommentRepository } from '../comments/repository'
import { planCommentScope } from '../comments/contracts'
import { planReviewKey, type PlanDismissedBy, type PlanRecord, type SessionPlan } from './contracts'
import { planNotice } from './notices'
import type { PlanFiles } from './plan-files'
import type { PlanOwner, PlanRepository } from './repository'
import { createApproveOps } from './service-approve'
import { createPlanServiceCore } from './service-core'
import { createPresentOps } from './service-present'
import { planReviewText } from './wake-content'

/** Why a version stopped waiting on the person — the attention item's settle reason. */
export type PlanSettleReason = 'answered' | 'dismissed' | 'superseded'

/**
 * Everything a transition SAYS, injected so the plans feature imports neither the chat writer nor
 * the attention registry. All best-effort: the decision is durable before any of them runs.
 */
export interface PlanLifecyclePort {
  /** One conversation line, on the ROOT session (`recordSessionNotice`). */
  notice(owner: PlanOwner, notice: StoredSystemNotice): Promise<void>
  /** The presenting participant's handle in the root conversation, for the presented line. */
  authorHandle(owner: PlanOwner, agentId: string): Promise<string | null>
  /** A version now waits on the person; any older waiting version is superseded by it. */
  awaiting(owner: PlanOwner, plan: SessionPlan, authorHandle: string | null): void
  /** A version stopped waiting on the person; `null` is every version of the conversation. */
  settled(owner: PlanOwner, planId: string | null, reason: PlanSettleReason): void
  /** The approved plan is done — an informational journal row; nothing waits on anyone. */
  completed(owner: PlanOwner, plan: SessionPlan): void
}

export interface PlanServiceDeps {
  repo: PlanRepository
  comments: Pick<CommentRepository, 'takeOpen' | 'update'>
  /** The conversation's versions changed: push all of them (`plan.updated`). */
  publish: (owner: PlanOwner, plans: SessionPlan[]) => void
  /**
   * A version was just presented or restored: the live cue a client opens the plan tab on
   * (`plan.presented`, never replayed). Absent in a narrow host (tests).
   */
  presented?: (owner: PlanOwner, plan: SessionPlan) => void
  /** The draft and the version snapshots, through the root session's execution environment. */
  files: PlanFiles
  /** Switch the ROOT session's permission mode through the session update path. */
  setMode: (owner: PlanOwner, mode: PermissionMode) => Promise<void>
  /** The one wake delivery (`features/triggers/delivery.ts` `deliver`). */
  wake: (request: WakeRequest) => Promise<WakeOutcome>
  /** The ROOT conversation's participant handles — whom an approval may name. */
  participants: (owner: PlanOwner) => Promise<readonly string[]>
  /** Absent in a narrow host (tests): the decisions still hold, nothing is announced. */
  lifecycle?: PlanLifecyclePort
  now?: () => string
}

export interface PlanDecision {
  plan: SessionPlan
  /**
   * Whether the agent was reached: `failed` means the decision stands but nobody was woken;
   * `null` means this call decided nothing new (the same decision repeated), so it woke nobody.
   */
  wake: WakeOutcome['status'] | null
  /**
   * Every version of the conversation after the decision, newest first — what the client applies
   * at once, so its strip never waits on a `plan.updated` frame it may have missed.
   */
  plans: SessionPlan[]
}

/** A decision that only puts a version somewhere: the version, and every version after it. */
export interface PlanChange {
  plan: SessionPlan
  plans: SessionPlan[]
}

export function createPlanService(deps: PlanServiceDeps) {
  const lifecycle = deps.lifecycle
  const core = createPlanServiceCore(deps)
  const { now, publish, notice, view, listViews, requirePlan, conflict } = core
  const presenting = createPresentOps(core)
  const approving = createApproveOps(core)

  /** A review goes back to the author: the revision is theirs to write. */
  const wakeAuthor = (plan: PlanRecord, content: string, deliveryKey: string) =>
    deps.wake({
      userId: plan.userId,
      sessionId: plan.sessionId,
      content,
      source: 'plan-review',
      to: { participant: agentParticipant(plan.authorAgentId) },
      deliveryKey,
      receipt: true,
    })

  /** Set a version aside and say so, in the voice of whoever set it aside. */
  const setAside = async (
    owner: PlanOwner,
    planId: string,
    by: PlanDismissedBy,
    line: (plan: PlanRecord) => StoredSystemNotice,
  ): Promise<{ plan: PlanRecord; plans: SessionPlan[] } | null> => {
    const plan = await deps.repo.dismiss(planId, now(), by)
    if (!plan) return null
    const plans = await publish(owner)
    await notice(owner, line(plan))
    lifecycle?.settled(owner, plan.id, 'dismissed')
    return { plan, plans }
  }

  return {
    /** The agent presents the draft (the `plan` tool, action `present`): `service-present.ts`. */
    present: presenting.present,

    /** Every version, newest first, and the draft's state — the plan view and the agent's `read`. */
    overview: presenting.overview,

    /** Every version, newest first. */
    async list(owner: PlanOwner): Promise<SessionPlan[]> {
      return listViews(owner)
    },

    /** The version later runs follow (`approvedPlanSection`). */
    async approved(owner: PlanOwner): Promise<SessionPlan | null> {
      const plan = await deps.repo.approved(owner)
      return plan ? view(owner, plan) : null
    },

    /** The person brings the latest version back to review (`service-present.ts`). */
    reopen: presenting.reopen,

    /** Approve a version in the mode the person chose, addressed to whom they chose. */
    approve: approving.approve,

    /** Send the version's open comments, and the person's note, back to the agent. */
    async requestChanges(
      owner: PlanOwner,
      planId: string,
      note: string | undefined,
    ): Promise<PlanDecision & { comments: number }> {
      const plan = await requirePlan(owner, planId)
      if (plan.status !== 'presented') await conflict(owner, plan)
      const comments = await deps.comments.takeOpen(owner.userId, planCommentScope(plan.id))
      if (!comments.length && !note)
        throw new ApiError(400, 'review_empty', 'Add a comment or a note before requesting changes')
      const round = await deps.repo.nextReviewRound(plan.id)
      const outcome =
        round === null
          ? ({ status: 'missed', reason: 'decided' } as const)
          : await wakeAuthor(
              plan,
              planReviewText(plan, comments, note),
              planReviewKey(plan.id, round),
            )
      // Not delivered → the comments go back on the plan, where the person can send them again,
      // and nothing is announced: the review did not happen yet.
      if (outcome.status !== 'delivered') {
        for (const comment of comments)
          await deps.comments.update(owner.userId, comment.id, { status: 'open' })
      } else {
        await deps.repo.reviewDelivered(plan.id)
        await notice(owner, planNotice.changesRequested(plan, comments.length))
        // The next move is the agent's revision, so the version stops waiting on the person.
        lifecycle?.settled(owner, plan.id, 'answered')
      }
      return {
        plan: await view(owner, plan),
        wake: outcome.status,
        comments: comments.length,
        plans: await listViews(owner),
      }
    },

    /**
     * Put a version aside — a presented one unanswered, or an approved one abandoned. No wake.
     * Dismissing a version already dismissed is the same decision repeated (a second tab, a
     * client that missed the frame): it answers the versions as they are, not a 409.
     */
    async dismiss(owner: PlanOwner, planId: string): Promise<PlanChange> {
      // Ownership first: another conversation's (or user's) version is a 404, never written.
      await requirePlan(owner, planId)
      const done = await setAside(owner, planId, 'person', planNotice.dismissed)
      if (done) return { plan: await view(owner, done.plan), plans: done.plans }
      const after = await requirePlan(owner, planId)
      if (after.status !== 'dismissed') return conflict(owner, after)
      return { plan: await view(owner, after), plans: await listViews(owner) }
    },

    /** The implementing agent declares the approved plan done (`plan` action `complete`). */
    async complete(owner: PlanOwner, summary: string): Promise<SessionPlan> {
      const approved = await deps.repo.approved(owner)
      if (!approved)
        throw new ApiError(409, 'no_approved_plan', 'This conversation has no approved plan')
      const plan =
        (await deps.repo.complete(approved.id, summary, now())) ?? (await conflict(owner, approved))
      const done = await view(owner, plan)
      await publish(owner)
      await notice(owner, planNotice.completed(done, summary))
      lifecycle?.completed(owner, done)
      return done
    },

    /**
     * The root's mode moved (`SessionLifecycleCtx.onPermissionModeChanged`). Leaving plan mode
     * with a version still waiting sets it aside: it was written for a read-only conversation
     * the person has just ended, and a card asking to approve it would switch the mode AGAIN.
     * That dismissal is the MODE's, not the person's, so returning to Plan mode brings the
     * version back — one session lost v2's Approve to a mode round-trip, and the agent re-typed
     * it as a new version. A version the person dismissed stays dismissed.
     */
    async permissionModeChanged(
      owner: PlanOwner,
      before: PermissionMode | undefined,
      after: PermissionMode,
    ): Promise<void> {
      if (after !== 'plan') {
        const waiting = await deps.repo.presented(owner)
        if (waiting) await setAside(owner, waiting.id, 'mode', planNotice.leftPlanMode)
        return
      }
      if (before === 'plan') return
      const latest = (await deps.repo.list(owner))[0]
      if (latest?.status === 'dismissed' && latest.dismissedBy === 'mode')
        await presenting.restore(owner, latest)
    },
  }
}

export type PlanService = ReturnType<typeof createPlanService>
