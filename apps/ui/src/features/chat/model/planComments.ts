/**
 * A PLAN'S REVIEW COMMENTS, AS THE SERVER KEEPS THEM — the client's cache and its only writers.
 *
 * The previous plan review kept comments in client memory, read by one button: a reload, or a
 * reply typed instead of that button, lost every one. Here every add, edit and delete is a request
 * to `/rpc/comments` first, and this store only mirrors what the server answered — so the strip's
 * count, the plan tab's highlights and what "Request changes" sends are the same rows.
 *
 * Keyed by comment scope (`plan:<planId>`): one list per version.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { CommentView, SessionPlan } from '@localixai/api/client'
import { backendClient } from '@/shared/api/client'
import { planCommentScope } from '@/shared/api/plans-client'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

import { commentQuote, decideCarryOver } from './planCommentCarry'

interface PlanCommentsState {
  byScope: Record<string, CommentView[]>
  setScope: (scope: string, comments: CommentView[]) => void
  upsert: (comment: CommentView) => void
  drop: (scope: string, id: string) => void
}

export const usePlanCommentsStore = create<PlanCommentsState>((set) => ({
  byScope: {},
  setScope: (scope, comments) => set((s) => ({ byScope: { ...s.byScope, [scope]: comments } })),
  upsert: (comment) =>
    set((s) => {
      const list = s.byScope[comment.scope] ?? []
      const next = list.some((c) => c.id === comment.id)
        ? list.map((c) => (c.id === comment.id ? comment : c))
        : [...list, comment]
      return { byScope: { ...s.byScope, [comment.scope]: next } }
    }),
  drop: (scope, id) =>
    set((s) => ({
      byScope: { ...s.byScope, [scope]: (s.byScope[scope] ?? []).filter((c) => c.id !== id) },
    })),
}))

const inFlight = new Map<string, Promise<CommentView[]>>()

/** Fetch a version's comments; cached unless `force` (after a review changed their status). */
export function loadPlanComments(planId: string, force = false): Promise<CommentView[]> {
  const scope = planCommentScope(planId)
  const cached = usePlanCommentsStore.getState().byScope[scope]
  if (cached && !force) return Promise.resolve(cached)
  const running = inFlight.get(scope)
  if (running) return running
  const request = backendClient
    .listComments(scope)
    .then((comments) => {
      usePlanCommentsStore.getState().setScope(scope, comments)
      return comments
    })
    .finally(() => inFlight.delete(scope))
  inFlight.set(scope, request)
  return request
}

/** Every write goes to the server first; the store takes only what it answered. */
export const planCommentActions = {
  async add(planId: string, quote: string, body: string): Promise<void> {
    const comment = await backendClient.createComment(planCommentScope(planId), { quote }, body)
    usePlanCommentsStore.getState().upsert(comment)
  },
  async edit(comment: CommentView, body: string): Promise<void> {
    usePlanCommentsStore.getState().upsert(await backendClient.updateComment(comment.id, { body }))
  },
  async remove(comment: CommentView): Promise<void> {
    await backendClient.deleteComment(comment.id)
    usePlanCommentsStore.getState().drop(comment.scope, comment.id)
  },
}

const carried = new Set<string>()

/**
 * Move the previous version's unsent comments onto `next`, or mark them outdated
 * (`planCommentCarry.ts`). Once per new version per process; a failure lets a later mount retry.
 */
export async function carryOverComments(previous: SessionPlan, next: SessionPlan): Promise<void> {
  if (carried.has(next.id)) return
  carried.add(next.id)
  try {
    const { carry, outdated } = decideCarryOver(await loadPlanComments(previous.id), next.body)
    const store = usePlanCommentsStore.getState()
    for (const comment of carry) {
      // Created on the new version before the old row goes, so a failure in between leaves a
      // duplicate the person can delete — never a comment that exists nowhere.
      const moved = await backendClient.createComment(
        planCommentScope(next.id),
        { quote: commentQuote(comment) },
        comment.body,
      )
      store.upsert(moved)
      await backendClient.deleteComment(comment.id)
      store.drop(comment.scope, comment.id)
    }
    for (const comment of outdated)
      store.upsert(await backendClient.updateComment(comment.id, { status: 'outdated' }))
  } catch (error) {
    carried.delete(next.id)
    // Silent, the person's unsent comments simply were not on the new version, with nothing to
    // say they still exist on the previous one.
    toast.error('Could not move your comments to the new plan version', {
      description: [
        'They are still on the previous version; reopening the plan tries again.',
        errorMessage(error, ''),
      ]
        .filter(Boolean)
        .join(' '),
    })
  }
}

/** A comment list that would not load draws like "no comments": say it did not load. */
export function reportPlanCommentsLoad(error: unknown): void {
  toast.error('Could not load the plan comments', {
    description: errorMessage(error, '') || undefined,
  })
}

const EMPTY: readonly CommentView[] = []

/** A version's comments, loaded on first use. */
export function usePlanComments(planId: string | null | undefined): readonly CommentView[] {
  const scope = planId ? planCommentScope(planId) : null
  const comments = usePlanCommentsStore((s) => (scope ? s.byScope[scope] : undefined))
  useEffect(() => {
    // A failed load leaves the cache empty; the next mount asks again.
    if (planId) loadPlanComments(planId).catch(reportPlanCommentsLoad)
  }, [planId])
  return comments ?? EMPTY
}

export const openComments = (comments: readonly CommentView[]) =>
  comments.filter((comment) => comment.status === 'open')

/** Reset between tests: the cache and the once-per-version carry memory are process-wide. */
export function resetPlanCommentsForTest(): void {
  usePlanCommentsStore.setState({ byScope: {} })
  carried.clear()
  inFlight.clear()
}
