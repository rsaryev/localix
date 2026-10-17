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
 *   delegate, or `delegate` message → it waits                                 (`expectReport`)
 *   a run ends completed or failed → if it waits, report once; it stops waiting (`takeExpectedReport`)
 *   a run ends STOPPED             → no report: the delegator stopped it and its own tool result
 *                                     said so, or a person stopped it and the child is theirs now;
 *                                     a person's Stop leaves the wait standing, so the parent still
 *                                     hears once when the child next finishes or fails
 *   the delegator stops or closes  → it stops waiting                           (`dropExpectedReport`)
 *
 * A delegator that called `delegate` with `wait: true` is waiting IN ITS TURN, not for a later
 * message: the report goes to its open call (`holdReport`) and no wake is sent. When the wait's
 * deadline passes first, the hold goes and the report travels the usual way. A Stop of the
 * delegator's run aborts the call and, through the stop cascade, the child: no report follows.
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

/** What a held report hands the delegating call: how the run ended, and its final text. */
export interface HeldReport {
  status: 'completed' | 'failed' | 'stopped'
  text: string | null
}

const held = new Map<string, (report: HeldReport) => void>()

/**
 * Hold the child's next report for a call that waits on it. Registered BEFORE the child starts,
 * so a child that ends inside the launch's settle window still reaches the call. Resolves with
 * `null` when the deadline passes or `signal` aborts; the report then goes out as a message.
 */
export function holdReport(
  childId: string,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<HeldReport | null> {
  return new Promise((resolve) => {
    const finish = (report: HeldReport | null) => {
      if (held.get(childId) !== deliver) return
      held.delete(childId)
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', abort)
      resolve(report)
    }
    const deliver = (report: HeldReport) => finish(report)
    const abort = () => finish(null)
    const timer = setTimeout(abort, opts.timeoutMs)
    held.set(childId, deliver)
    if (opts.signal?.aborted) abort()
    else opts.signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Hand a run's outcome to the call holding it. True when one was holding it: send no wake. */
export function deliverHeldReport(childId: string, report: HeldReport): boolean {
  const deliver = held.get(childId)
  if (!deliver) return false
  deliver(report)
  return true
}

/** Test seam: forget every wait. Never call this from production code. */
export function __resetExpectedReports(): void {
  expecting.clear()
  held.clear()
}
