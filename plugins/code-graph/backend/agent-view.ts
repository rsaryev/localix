import type { AgentView } from '../shared/view'
import type { GraphCameraReport } from '../shared/camera'

/**
 * What the agent last asked the map to show, per project and chat.
 *
 * It lives in the backend, not only in a message to the UI: an open tab is pushed each request as
 * it is made (`ws-frames.ts`), and the snapshot carries the latest too, so a highlight requested
 * while the tab was closed or hidden is there when it opens, and one requested from a subagent
 * reaches the same tab. The revision lets the view apply each request
 * exactly once and then leave the person free to wander off it.
 *
 * Deliberately not persisted: a highlight is a pointer for this conversation, and one resurrected
 * after a restart would point at yesterday's question.
 */
const views = new Map<string, AgentView>()
const reports = new Map<string, { report: GraphCameraReport; at: number }>()
const waiting = new Map<string, Set<(report: GraphCameraReport, at: number) => void>>()
const tabs = new Map<string, Set<(event: AgentViewEvent) => void>>()
const keyOf = (root: string, sessionId: string) => JSON.stringify([root, sessionId])
let revision = 0
let asks = 0

/** A request older than this is not replayed to a tab that opens late: it would move a camera
 *  the person has long since moved themselves. */
export const REQUEST_TTL_MS = 15_000

/** How long a tab's camera report answers {@link readGraphView}. */
const REPORT_TTL_MS = 10_000

/** What an open tab is told, as it happens (`ws-frames.ts` carries it to the socket). */
export type AgentViewEvent = { kind: 'agent'; agent: AgentView } | { kind: 'report'; ask: number }

export function readAgentView(root: string, sessionId?: string): AgentView | undefined {
  return sessionId ? views.get(keyOf(root, sessionId)) : undefined
}

export function showInView(
  root: string,
  sessionId: string,
  request: Omit<AgentView, 'revision'>,
): AgentView {
  revision += 1
  const view: AgentView = { ...request, revision }
  views.set(keyOf(root, sessionId), view)
  for (const deliver of tabs.get(keyOf(root, sessionId)) ?? [])
    deliver({ kind: 'agent', agent: view })
  return view
}

/**
 * Follow one chat's map requests while its tab is open. A request made in the last
 * {@link REQUEST_TTL_MS} is delivered at once, so a tab the tool just opened still gets the move
 * that opened it.
 */
export function subscribeAgentView(
  root: string,
  sessionId: string,
  listener: (event: AgentViewEvent) => void,
): () => void {
  const key = keyOf(root, sessionId)
  const listeners = tabs.get(key) ?? new Set()
  tabs.set(key, listeners)
  listeners.add(listener)
  const current = views.get(key)
  if (current && Date.now() - (current.requestedAt ?? 0) < REQUEST_TTL_MS)
    listener({ kind: 'agent', agent: current })
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    tabs.delete(key)
    // The camera report answers only an open tab; without one it would stay for the process.
    reports.delete(key)
  }
}

/**
 * Ask the chat's open tabs to report their camera now. False when no tab is listening, so the
 * caller does not wait for an answer nobody can give.
 */
export function requestGraphReport(root: string, sessionId: string): boolean {
  const listeners = tabs.get(keyOf(root, sessionId))
  if (!listeners?.size) return false
  asks += 1
  for (const deliver of listeners) deliver({ kind: 'report', ask: asks })
  return true
}

export function clearAgentView(root: string, sessionId: string): void {
  views.delete(keyOf(root, sessionId))
}

export function reportGraphView(root: string, sessionId: string, report: GraphCameraReport): void {
  const key = keyOf(root, sessionId)
  const previous = reports.get(key)
  if (previous && previous.report.revision > report.revision) return
  const at = Date.now()
  reports.set(key, { report, at })
  // A report older than REPORT_TTL_MS is never read again: drop it, so the map stays bounded.
  for (const [other, entry] of reports) if (at - entry.at >= REPORT_TTL_MS) reports.delete(other)
  for (const deliver of waiting.get(key) ?? []) deliver(report, at)
}

export function readGraphView(root: string, sessionId: string): GraphCameraReport | undefined {
  const entry = reports.get(keyOf(root, sessionId))
  return entry && Date.now() - entry.at < REPORT_TTL_MS ? entry.report : undefined
}

/** A queued request is not an applied move: only the tab's matching report confirms it. */
export function awaitGraphView(
  root: string,
  sessionId: string,
  revision: number,
  timeoutMs = 6000,
): Promise<GraphCameraReport | null> {
  const ready = readGraphView(root, sessionId)
  if (ready?.revision === revision) return Promise.resolve(ready)
  return awaitReport(root, sessionId, (report) => report.revision === revision, timeoutMs)
}

/** The first report the tab sends at or after `since` — the answer to {@link requestGraphReport}. */
export function awaitGraphReportSince(
  root: string,
  sessionId: string,
  since: number,
  timeoutMs = 3000,
): Promise<GraphCameraReport | null> {
  const entry = reports.get(keyOf(root, sessionId))
  if (entry && entry.at >= since) return Promise.resolve(entry.report)
  return awaitReport(root, sessionId, (_report, at) => at >= since, timeoutMs)
}

function awaitReport(
  root: string,
  sessionId: string,
  accept: (report: GraphCameraReport, at: number) => boolean,
  timeoutMs: number,
): Promise<GraphCameraReport | null> {
  const key = keyOf(root, sessionId)
  return new Promise((resolve) => {
    const listeners = waiting.get(key) ?? new Set()
    waiting.set(key, listeners)
    const finish = (report: GraphCameraReport | null) => {
      clearTimeout(timer)
      listeners.delete(deliver)
      if (!listeners.size) waiting.delete(key)
      resolve(report)
    }
    const deliver = (report: GraphCameraReport, at: number) => {
      if (accept(report, at)) finish(report)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    listeners.add(deliver)
  })
}
