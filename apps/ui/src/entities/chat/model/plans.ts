/**
 * WHERE A CONVERSATION'S PLAN IS READ FROM, AND HOW IT GETS THERE.
 *
 * Plans belong to the ROOT session (a delegated child runs under its root's mode, which is what an
 * approval changes), so every reader resolves the root first — a child's composer showing its own,
 * always-empty list would hide the plan that governs it.
 *
 * THE SERVER IS THE ONE SOURCE, AND EVERY READ OF IT REPLACES THE LIST. A root session's DETAIL
 * carries its `plans` (`mergeSessionBody` replaces the stored list with it), the live
 * `plan.updated` frame replaces it, and every decision's answer replaces it (`applyPlanList`) —
 * all through the one reducer. The list used to be loaded once and then kept alive only by the
 * frame, so one missed frame (a reconnect gap) left the strip offering Approve on a version the
 * server had already approved, for good. Now any detail refetch or click corrects it.
 *
 * `plans` stays undefined while unknown — a child's composer whose root was only ever listed, a
 * dialog about another conversation — and `ensurePlansLoaded` fetches it then; a converter that
 * blanked it to `[]` would make "not loaded" and "none" indistinguishable.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { SessionPlan } from '@localixai/api/client'
import { backendClient } from '@/shared/api/client'
import type { PlanDraftInfo } from '@/shared/api/plans-client'
import { inspector } from '@/shared/lib/inspectorBus'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { findSessionInState } from './findSession'
import { useChatStore } from './store'

const EMPTY: readonly SessionPlan[] = []
/** The session that owns the plans `sessionId` lives under. */
export function usePlanOwnerId(sessionId: string | null): string | null {
  return useChatStore((state) => {
    const session = findSessionInState(state, sessionId)
    if (!session) return sessionId
    return session.rootSessionId ?? session.id
  })
}

/** The owner's versions, newest first; `undefined` while they were never loaded. */
export function usePlans(ownerId: string | null): readonly SessionPlan[] | undefined {
  return useChatStore((state) => findSessionInState(state, ownerId)?.plans)
}

export function usePlanList(ownerId: string | null): readonly SessionPlan[] {
  return usePlans(ownerId) ?? EMPTY
}

/** Replace the owner's versions with a list the server answered — the frame's own reducer. */
export function applyPlanList(ownerId: string, plans: SessionPlan[]): void {
  useChatStore
    .getState()
    ._applyStreamEvent(ownerId, { type: 'plan.updated', sessionId: ownerId, plans })
}

const inFlight = new Map<string, Promise<void>>()

/**
 * Fetch the owner's plans while they are unknown. Applied only while the list is still unknown: a
 * `plan.updated` or a detail that arrived during the request is newer than the response and wins.
 */
export function ensurePlansLoaded(ownerId: string): Promise<void> {
  const known = findSessionInState(useChatStore.getState(), ownerId)?.plans
  if (known) return Promise.resolve()
  const running = inFlight.get(ownerId)
  if (running) return running
  const request = backendClient
    .listPlans(ownerId)
    .then(({ plans, draft }) => {
      storePlanDraft(ownerId, draft)
      const store = useChatStore.getState()
      if (findSessionInState(store, ownerId)?.plans) return
      applyPlanList(ownerId, plans)
    })
    // A failed load leaves the list unknown, so the next mount asks again. It used to say nothing,
    // and an unknown list draws exactly like "no plan yet" — the person opened the plan and was
    // told, wrongly, that there is none. So the failure is said; the retry stays the next mount.
    .catch((error: unknown) => {
      toast.error('Could not load the plan for this conversation', {
        description: errorMessage(error, '') || undefined,
      })
    })
    .finally(() => inFlight.delete(ownerId))
  inFlight.set(ownerId, request)
  return request
}

/** Load the owner's plans when a surface that shows them mounts. */
export function usePlansLoaded(ownerId: string | null): void {
  useEffect(() => {
    if (ownerId) void ensurePlansLoaded(ownerId)
  }, [ownerId])
}

/**
 * THE DRAFT FILE'S STATE, NEXT TO THE VERSIONS IT BECOMES.
 *
 * The agent edits `PLAN.md` with ordinary file tools and nothing is streamed when it does, so a
 * plan tab showing v2 could not tell the person that v3 was already being written — they would
 * approve v2 while the agent was changing it. Only `GET plans` knows (`draft.changed`), so it is
 * kept here per owner and re-asked whenever a surface that shows it comes into view.
 */
export const usePlanDraftStore = create<{ byOwner: Record<string, PlanDraftInfo> }>(() => ({
  byOwner: {},
}))

function storePlanDraft(ownerId: string, draft: PlanDraftInfo | null): void {
  if (!draft) return
  usePlanDraftStore.setState((s) => ({ byOwner: { ...s.byOwner, [ownerId]: draft } }))
}

/** The owner's draft as last fetched; null before the first answer. */
export function usePlanDraft(ownerId: string | null): PlanDraftInfo | null {
  return usePlanDraftStore((s) => (ownerId ? (s.byOwner[ownerId] ?? null) : null))
}

const draftInFlight = new Map<string, Promise<void>>()

/**
 * Re-ask for the draft. Only the draft is taken from the answer: the versions are kept live by
 * `plan.updated`, and a fetched list applied here could overwrite a newer pushed one.
 *
 * A failure is not toasted: this runs every time the tab is shown, the notice it feeds is
 * advisory and keeps its last answer, and the first load (`ensurePlansLoaded`) already says when
 * the plans cannot be reached.
 */
export function refreshPlanDraft(ownerId: string): Promise<void> {
  const running = draftInFlight.get(ownerId)
  if (running) return running
  const request = backendClient
    .listPlans(ownerId)
    .then(({ draft }) => storePlanDraft(ownerId, draft))
    .catch(() => undefined)
    .finally(() => draftInFlight.delete(ownerId))
  draftInFlight.set(ownerId, request)
  return request
}

/**
 * Keep the draft current while a surface shows it: on coming into view, and whenever `revision`
 * (the newest version and its status) moves — a presentation makes the draft equal again.
 */
export function usePlanDraftRefresh(ownerId: string | null, visible: boolean, revision: string) {
  useEffect(() => {
    if (ownerId && visible) void refreshPlanDraft(ownerId)
  }, [ownerId, visible, revision])
}

export const PLAN_WORK_KIND = 'plan'

/** What the plan tab reads from its payload; anything else in it is ignored. */
export interface PlanTabPayload {
  ownerId: string
  /** The version to show; absent shows the newest. */
  planId?: string
}

/**
 * Open (or reveal) the conversation's plan tab in the chat `sessionId`. ONE tab per conversation,
 * keyed by its owner, with the version picked inside it — so every way in (the strip, the tool
 * card, the auto-open) reveals the same tab instead of stacking one per version, and a tab the
 * person closed is simply opened again.
 */
export function openPlanTab(request: {
  sessionId: string
  ownerId: string
  planId?: string
  title?: string
}): void {
  const payload: PlanTabPayload = { ownerId: request.ownerId, planId: request.planId }
  inspector.openWorkItem({
    workKind: PLAN_WORK_KIND,
    id: `plan:${request.ownerId}`,
    title: request.title ? `Plan · ${request.title}` : 'Plan',
    scope: request.sessionId,
    payload: { ...payload },
  })
}

/** The version waiting for the person, if any — at most one per conversation. */
export function presentedPlan(plans: readonly SessionPlan[]): SessionPlan | undefined {
  return plans.find((plan) => plan.status === 'presented')
}

/**
 * The version a mode change would set aside: the NEWEST one, while it waits for the person.
 * Leaving Plan mode dismisses exactly that one, so the mode menu asks only when it exists.
 */
export function latestPresentedPlan(plans: readonly SessionPlan[]): SessionPlan | undefined {
  const latest = plans[0]
  return latest?.status === 'presented' ? latest : undefined
}

/**
 * The version the person can bring back for review: the NEWEST one, once set aside. The server
 * reopens only the latest, so an older dismissed version (with something newer after it) is
 * history, not something to offer.
 */
export function reopenablePlan(plans: readonly SessionPlan[]): SessionPlan | undefined {
  const latest = plans[0]
  return latest?.status === 'dismissed' ? latest : undefined
}

/**
 * The approved version the agent is implementing, if any. Only `approved` counts: a `completed`
 * version is finished work, and treating it as still steering would keep a "Implementing" reminder
 * on screen after the agent reported it done.
 */
export function implementingPlan(plans: readonly SessionPlan[]): SessionPlan | undefined {
  return plans.find((plan) => plan.status === 'approved')
}

/** The version that was presented immediately before `plan`, for its "Changes" diff. */
export function previousVersion(
  plans: readonly SessionPlan[],
  plan: SessionPlan,
): SessionPlan | undefined {
  return plans
    .filter((candidate) => candidate.version < plan.version)
    .sort((a, b) => b.version - a.version)[0]
}

/**
 * OPENING THE PLAN TAB BY ITSELF — on the server's word that a version was presented just now.
 *
 * It used to be inferred from the list: a presented version the client had not "seen" before, or,
 * for a conversation it had never held, one younger than two minutes. Both guesses failed where it
 * mattered — a reload within the window stole the tab, and a whole-body replace erased the memory
 * so a fresh version never opened. The server now says it once, as the live-only `plan.presented`
 * frame (never replayed, so a reload or a reconnect opens nothing), and this only decides WHERE:
 * the focused composer of that conversation, else the conversation's own (root) composer — so a
 * plan presented while the person is elsewhere is open when they come back. Each version opens at
 * most once per process, so a person who closed the tab is not followed by it.
 */
interface PlanTabHost {
  sessionId: string
  ownerId: string
  focused: boolean
}
const tabHosts = new Set<PlanTabHost>()
const cuedPlans = new Set<string>()

/** The `plan.presented` frame (`agent-runtime.ts` routes it here, before the store). */
export function routePlanPresented(event: { sessionId: string; planId: string }): void {
  if (cuedPlans.has(event.planId)) return
  const hosts = [...tabHosts].filter((host) => host.ownerId === event.sessionId)
  const host =
    hosts.find((candidate) => candidate.focused) ??
    hosts.find((candidate) => candidate.sessionId === candidate.ownerId)
  if (!host) return
  cuedPlans.add(event.planId)
  const plan = findSessionInState(useChatStore.getState(), event.sessionId)?.plans?.find(
    (candidate) => candidate.id === event.planId,
  )
  openPlanTab({
    sessionId: host.sessionId,
    ownerId: event.sessionId,
    planId: event.planId,
    title: plan?.title,
  })
}

/** Offer a composer as a place the plan tab may open in; answers the withdrawal. */
export function registerPlanTabHost(host: PlanTabHost): () => void {
  const entry = { ...host }
  tabHosts.add(entry)
  return () => {
    tabHosts.delete(entry)
  }
}

/** Offer this composer as a place the conversation's plan tab may open in (`routePlanPresented`). */
export function usePlanTabHost(
  sessionId: string | null,
  ownerId: string | null,
  focused: boolean,
): void {
  useEffect(() => {
    if (!sessionId || !ownerId) return
    return registerPlanTabHost({ sessionId, ownerId, focused })
  }, [sessionId, ownerId, focused])
}
