/**
 * "CONTINUE" IN THE COMPOSER — the conversation's unfinished work, and when it may be offered.
 *
 * The points belong to the ROOT session (`features/resume` on the server), so every reader
 * resolves the root first, as the plans do; they arrive with its detail, live through
 * `session_resume.updated`, and in every Continue answer — all through the one reducer.
 *
 * WHEN a point is offered is ONE rule, here, read from server facts the store already holds:
 * nobody is working on the conversation. Not the agent's run, not a turn waiting in the queue
 * (the approval's own wake sits there before its run starts — without this Continue flashed
 * between Approve and the first token), not a request waiting on the person, not a delegated
 * child still running. Offering Continue while any of those is true would ask the agent to start
 * work it is already doing.
 */
import { useEffect, useState } from 'react'
import type { ResumePoint } from '@localixai/api/client'
import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

import { findSessionInState } from './findSession'
import { useChatStore } from './store'

const EMPTY: readonly ResumePoint[] = []

/**
 * Kinds whose Continue is drawn inside their own row, so the general `ResumeStrip` skips them —
 * one row per piece of work, never two. `plan`: the approved plan's row (`PlanStrip.tsx`).
 */
export const RESUME_KINDS_WITH_OWN_ROW: ReadonlySet<string> = new Set(['plan'])

/** Replace the owner's points with a list the server answered — the frame's own reducer. */
export function applyResumePoints(ownerId: string, points: ResumePoint[]): void {
  useChatStore
    .getState()
    ._applyStreamEvent(ownerId, { type: 'session_resume.updated', sessionId: ownerId, points })
}

const inFlight = new Map<string, Promise<void>>()

/** Fetch the owner's points while they are unknown; a frame or detail that landed meanwhile wins. */
function ensureResumeLoaded(ownerId: string): void {
  if (findSessionInState(useChatStore.getState(), ownerId)?.resumePoints) return
  if (inFlight.has(ownerId)) return
  const request = backendClient
    .listResumePoints(ownerId)
    .then((points) => {
      if (!findSessionInState(useChatStore.getState(), ownerId)?.resumePoints)
        applyResumePoints(ownerId, points)
    })
    // Unknown stays unknown, and an unknown list offers no Continue: nothing is claimed that
    // the server did not say. The next mount asks again.
    .catch(() => undefined)
    .finally(() => inFlight.delete(ownerId))
  inFlight.set(ownerId, request)
}

/** The owner's points, loading them when unknown; empty while unknown. */
export function useResumePoints(ownerId: string | null): readonly ResumePoint[] {
  const points = useChatStore((state) => findSessionInState(state, ownerId)?.resumePoints)
  useEffect(() => {
    if (ownerId) ensureResumeLoaded(ownerId)
  }, [ownerId])
  return points ?? EMPTY
}

/** Is anyone working on this session right now? The one rule above, for one session. */
export function sessionBusy(session: UiSession | undefined): boolean {
  if (!session) return true
  // Each field read defensively: a session object from an older shape may lack one, and a
  // missing list means "nothing there", not "busy".
  return (
    Boolean(session.isRunning) ||
    (session.queuedMessages ?? []).length > 0 ||
    Boolean(session.pendingInteraction) ||
    (session.work ?? []).some((work) => work.kind === 'subagent')
  )
}

/**
 * Nobody is working on the conversation: neither the composer's own session nor the root that
 * owns the work. Unknown sessions count as busy — Continue is offered on evidence, never by default.
 */
export function useConversationIdle(sessionId: string | null, ownerId: string | null): boolean {
  return useChatStore((state) => {
    if (!sessionId || !ownerId) return false
    const own = findSessionInState(state, sessionId)
    const owner = sessionId === ownerId ? own : findSessionInState(state, ownerId)
    return !sessionBusy(own) && !sessionBusy(owner)
  })
}

/**
 * Continue one point. A delivered wake needs no message — the turn it opens is the answer. A
 * point that no longer holds replaces the list (the button goes) and says why, transiently; a
 * wake nobody received is said as a warning, because the person would otherwise wait for nothing.
 */
export function useResume(ownerId: string | null) {
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const resume = async (point: ResumePoint): Promise<void> => {
    if (!ownerId || busyKey) return
    setBusyKey(point.key)
    try {
      const answer = await backendClient.resumeWork(ownerId, point.key)
      applyResumePoints(ownerId, answer.points)
      if (answer.gone) toast.info(`${point.title} no longer needs continuing`)
      else if (answer.wake !== 'delivered')
        toast.warning(`${point.title}: the agent was not woken`, {
          description: 'Send a message to continue.',
        })
    } catch (error) {
      toast.error(`Could not continue ${point.title}`, {
        description: errorMessage(error, '') || undefined,
      })
    } finally {
      setBusyKey(null)
    }
  }

  return { busyKey, resume }
}
