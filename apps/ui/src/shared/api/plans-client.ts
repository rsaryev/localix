/**
 * The person's side of a plan the agent presented: list its versions, decide on one, and keep
 * review comments on the server. One of the `backendClient` domain modules spread into the facade
 * in `./client`.
 *
 * Comments are durable rows (`/rpc/comments`) rather than client memory because a comment kept
 * only in the browser was lost on reload, or whenever the one button that carried it was not the
 * one pressed. A plan's comments live under the scope `plan:<planId>`.
 */

import type {
  CommentStatus,
  CommentView,
  ImplementationMode,
  SessionPlan,
} from '@localixai/api/client'
import { client, unwrap } from './internal'

/** Where in a plan's rendered text a comment points — the sentence, and what surrounds it. */
export interface PlanCommentAnchor {
  quote: string
  prefix?: string
  suffix?: string
}

/**
 * A decision's wake: `delivered` reached the agent; `missed`/`failed` mean nobody was woken;
 * `null` means the call decided nothing new (the same decision repeated), so it woke nobody.
 */
export type PlanWakeStatus = 'delivered' | 'missed' | 'failed' | null

/** A decision the server refused because the version was decided meanwhile — and by what. */
export interface PlanConflict {
  code: string
  message: string
}

/**
 * What every decision answers: the conversation's versions AFTER it, newest first, beside either
 * the decision's own fields or the conflict that refused it. The list is there in both cases so
 * the caller applies it at once (a list that had missed its frame kept offering
 * Approve on an approved version, and every click was a 409 that corrected nothing).
 */
export type PlanAnswer<T> =
  | (T & { plans: SessionPlan[]; conflict?: undefined })
  | { plans: SessionPlan[]; conflict: PlanConflict }

/** Read a decision's response: a 409 that carries `plans` is an answer, not a failure. */
async function planAnswer<T>(response: Response): Promise<PlanAnswer<T>> {
  if (response.status === 409) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as {
      plans?: SessionPlan[]
      error?: { code?: string; message?: string }
    } | null
    if (body && Array.isArray(body.plans))
      return {
        plans: body.plans,
        conflict: {
          code: body.error?.code ?? 'plan_decided',
          message: body.error?.message ?? 'The plan was decided meanwhile',
        },
      }
  }
  return unwrap<T & { plans: SessionPlan[] }>(response)
}

export const planCommentScope = (planId: string) => `plan:${planId}`

/**
 * The agent's working draft (`PLAN.md`) beside the versions. `changed` says the draft differs
 * from the newest version — written, but not presented yet.
 */
export interface PlanDraftInfo {
  path: string
  exists: boolean
  changed: boolean
}

export const plansApi = {
  /**
   * Every version of the conversation's plan, newest first, and the state of its draft file.
   * `rootSessionId` owns them.
   */
  async listPlans(
    rootSessionId: string,
  ): Promise<{ plans: SessionPlan[]; draft: PlanDraftInfo | null }> {
    const json = await unwrap<{ plans: SessionPlan[]; draft?: PlanDraftInfo | null }>(
      await client.rpc.sessions[':id'].plans.$get({ param: { id: rootSessionId } }),
    )
    return { plans: json.plans, draft: json.draft ?? null }
  },

  /**
   * Bring the newest version back for review after it was set aside. The server also returns
   * the conversation to Plan mode, so the review it reopens is one the agent can still act on.
   */
  async reopenPlan(
    rootSessionId: string,
    planId: string,
  ): Promise<PlanAnswer<{ plan: SessionPlan }>> {
    return planAnswer<{ plan: SessionPlan }>(
      await client.rpc.sessions[':id'].plans[':planId'].reopen.$post({
        param: { id: rootSessionId, planId },
      }),
    )
  },

  /**
   * Approve a version and hand the conversation to `mode`. `to` is who starts — a participant's
   * handle or `all`; without it the conversation's default answerer does. The server answers 400
   * for a handle that is not in the conversation.
   */
  async approvePlan(
    rootSessionId: string,
    planId: string,
    mode: ImplementationMode,
    to?: string,
  ): Promise<PlanAnswer<{ plan: SessionPlan; wake: PlanWakeStatus }>> {
    return planAnswer<{ plan: SessionPlan; wake: PlanWakeStatus }>(
      await client.rpc.sessions[':id'].plans[':planId'].approve.$post({
        param: { id: rootSessionId, planId },
        json: to ? { mode, to } : { mode },
      }),
    )
  },

  /**
   * Send the version's open comments (and an optional note) back to the author. The server
   * answers 400 when there is neither; a comment it could not deliver goes back to `open`.
   */
  async requestPlanChanges(
    rootSessionId: string,
    planId: string,
    note?: string,
  ): Promise<PlanAnswer<{ plan: SessionPlan; wake: PlanWakeStatus; comments: number }>> {
    return planAnswer<{ plan: SessionPlan; wake: PlanWakeStatus; comments: number }>(
      await client.rpc.sessions[':id'].plans[':planId']['request-changes'].$post({
        param: { id: rootSessionId, planId },
        json: note ? { note } : {},
      }),
    )
  },

  /** Put a version aside. Nothing wakes. */
  async dismissPlan(
    rootSessionId: string,
    planId: string,
  ): Promise<PlanAnswer<{ plan: SessionPlan }>> {
    return planAnswer<{ plan: SessionPlan }>(
      await client.rpc.sessions[':id'].plans[':planId'].dismiss.$post({
        param: { id: rootSessionId, planId },
      }),
    )
  },

  async listComments(scope: string): Promise<CommentView[]> {
    const json = await unwrap<{ comments: CommentView[] }>(
      await client.rpc.comments.$get({ query: { scope } }),
    )
    return json.comments
  },

  async createComment(
    scope: string,
    anchor: PlanCommentAnchor,
    body: string,
  ): Promise<CommentView> {
    const json = await unwrap<{ comment: CommentView }>(
      await client.rpc.comments.$post({ json: { scope, anchor: { ...anchor }, body } }),
    )
    return json.comment
  },

  async updateComment(
    id: string,
    patch: { body?: string; status?: CommentStatus },
  ): Promise<CommentView> {
    const json = await unwrap<{ comment: CommentView }>(
      await client.rpc.comments[':id'].$patch({ param: { id }, json: patch }),
    )
    return json.comment
  },

  async deleteComment(id: string): Promise<void> {
    await unwrap<{ ok: true }>(await client.rpc.comments[':id'].$delete({ param: { id } }))
  },
}
