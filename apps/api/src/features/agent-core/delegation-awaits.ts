/**
 * WHETHER A DELEGATOR IS WAITING TO HEAR FROM ITS CHILD — the one fact that decides if a child's
 * run ends with a report.
 *
 * Every run of a delegated child used to report. That was right while only the delegator drove
 * the child, and it spammed the parent once a PERSON drove it too: someone who opens the child's
 * chat, stops it, and talks it through a problem produced a report per reply, plus a "STOPPED"
 * report for their own Stop — none of which the delegator had asked for. Who started a run is
 * the wrong question (a delegator message can join a run a person started, and then the delegator
 * IS waiting on it); whether the delegator still owes itself an answer is the right one:
 *
 *   fork, or `fork` action message → it waits                                  (`expectReport`)
 *   a run ends completed or failed → if it waits, report once; it stops waiting (`takeExpectedReport`)
 *   a run ends STOPPED             → no report: the delegator stopped it and its own tool result
 *                                     said so, or a person stopped it and the child is theirs now;
 *                                     a person's Stop leaves the wait standing, so the parent still
 *                                     hears once when the child next finishes or fails
 *   the delegator stops or closes  → it stops waiting                           (`dropExpectedReport`)
 *
 * In-process, like the lanes: a restart stops every child, and the recovery path reports those.
 */
const expecting = new Set<string>()

export function expectReport(childId: string): void {
  expecting.add(childId)
}

/** True once for a child whose delegator was waiting; the wait is consumed by the report. */
export function takeExpectedReport(childId: string): boolean {
  return expecting.delete(childId)
}

export function dropExpectedReport(childId: string): void {
  expecting.delete(childId)
}

/** Test seam: forget every wait. Never call this from production code. */
export function __resetExpectedReports(): void {
  expecting.clear()
}
