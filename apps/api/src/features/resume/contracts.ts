/**
 * WORK THE AGENT STOPPED ON — what the person can ask it to continue.
 *
 * The defect it exists to stop: a stopped run left an approved plan half-built, and the composer
 * offered only "Open". The person had to type "continue the plan" and hope the agent found the
 * plan again; nothing on screen said there was unfinished work at all. And a plan is only the
 * first such thing — a turn cut short by a restart, a background job a restart killed, a delegated
 * child that stopped without reporting are the same shape: started, not finished, nobody on it.
 *
 * So "continue" is one mechanism, not a button per feature. A feature that owns unfinished work
 * registers a PRODUCER: it lists the session's resume points and, when the person picks one,
 * answers what the agent is told — or that the point no longer holds. The registry
 * (`registry.ts`) owns everything else once: the wake, the conversation line, the 409 that hands
 * back the current list, and the push that keeps every composer in step.
 *
 * WHETHER the button shows is not a producer's question. A point is offered only while nobody
 * is working (no run, nothing queued, no request waiting on the person, no delegated child
 * running) — one rule, evaluated by the client from server facts it already holds, so a point
 * cannot be offered "continue" while the agent is visibly busy with it.
 */
import type { StoredSystemNotice } from '../../db/payload'

/** One piece of unfinished work in a ROOT conversation. */
export interface ResumePoint {
  /** `<kind>:<id>` — stable for as long as the work stays unfinished. */
  key: string
  /** The producer that owns it (`plan`, …); the client may give a kind its own presentation. */
  kind: string
  /** What the work is, short: "Plan v2". */
  title: string
  /** One line more: the plan's title, the job's command. */
  detail: string | null
}

/** The conversation a point belongs to — always the root: a child runs under its root's work. */
export interface ResumeOwner {
  userId: string
  sessionId: string
}

/** What continuing a point does: the agent's instruction, and the line the conversation shows. */
export interface ResumeAction {
  content: string
  notice: StoredSystemNotice
}

export interface ResumeProducer {
  kind: string
  /** The owner's unfinished work of this kind, newest first. */
  list(owner: ResumeOwner): Promise<ResumePoint[]>
  /** The point, if it still holds, as what to do now; null when it no longer holds. */
  take(owner: ResumeOwner, key: string): Promise<ResumeAction | null>
}

/** `<kind>:<id>` — the one spelling of a key, so a producer and the registry cannot disagree. */
export const resumeKey = (kind: string, id: string): string => `${kind}:${id}`

/** The kind a key names, or null for a malformed key. */
export function resumeKindOf(key: string): string | null {
  const at = key.indexOf(':')
  return at > 0 ? key.slice(0, at) : null
}
