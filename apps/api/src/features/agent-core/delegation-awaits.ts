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
 *
 * WHO WAITS, as well as whether: the delegator — its session and its participant — is recorded
 * with the wait, because a delegator that handed out several tasks is answered ONCE, when the last
 * of them reports. The wake queue holds the earlier reports until then (`chat/runtime/wake-queue/
 * holds.ts`) and asks this ledger whether anyone is still owed (`awaitsReports`). A report stays
 * owed while it is on its way — from the moment its run is taken here to the moment it is queued
 * (`settleReport`) — or a sibling's report would be released alone in that gap, just before it.
 */

/** Who a child reports to: the session it was delegated from, and the participant who did it. */
export interface Delegator {
  sessionId: string
  participant?: string
}

interface Wait {
  /** Absent for a wait no delegation recorded (a test's): it holds no sibling back. */
  delegator?: Delegator
  /** Taken: the run ended and its report is on its way, but not queued yet. */
  reporting: boolean
}

const expecting = new Map<string, Wait>()
const settledListeners = new Set<(sessionId: string) => void>()

function settled(delegator: Delegator | undefined): void {
  if (!delegator) return
  for (const listener of settledListeners) {
    try {
      listener(delegator.sessionId)
    } catch (error) {
      console.warn('[delegate] report settle listener failed:', error)
    }
  }
}

export function expectReport(childId: string, delegator?: Delegator): void {
  const known = expecting.get(childId)?.delegator
  expecting.set(childId, { delegator: delegator ?? known, reporting: false })
}

/**
 * True once for a child whose delegator was waiting; the wait is consumed by the report. The child
 * stays owed until its report is queued or decided against: call `settleReport` then.
 */
export function takeExpectedReport(childId: string): boolean {
  const wait = expecting.get(childId)
  if (!wait || wait.reporting) return false
  wait.reporting = true
  return true
}

/** The child's report was queued, handed to a waiting call, or will not be sent. */
export function settleReport(childId: string): void {
  const wait = expecting.get(childId)
  if (!wait?.reporting) return
  expecting.delete(childId)
  settled(wait.delegator)
}

export function dropExpectedReport(childId: string): void {
  const wait = expecting.get(childId)
  if (!wait) return
  expecting.delete(childId)
  settled(wait.delegator)
}

/**
 * Is `participant` of `sessionId` still owed a report by any child — other than `except`, the
 * children whose reports are already queued?
 */
export function awaitsReports(
  sessionId: string,
  participant: string | undefined,
  except: ReadonlySet<string> = new Set(),
): boolean {
  for (const [childId, wait] of expecting) {
    if (except.has(childId) || !wait.delegator) continue
    if (wait.delegator.sessionId === sessionId && wait.delegator.participant === participant)
      return true
  }
  return false
}

/**
 * Hear each time a child's report to a delegator of `sessionId` settles. A subscription, like the
 * work registry's `onChange`, so the queue that holds reports is wired at boot without this module
 * knowing it. Returns the unsubscribe.
 */
export function onReportSettled(listener: (sessionId: string) => void): () => void {
  settledListeners.add(listener)
  return () => {
    settledListeners.delete(listener)
  }
}

/** What a held report hands the delegating call: how the run ended, and its final text. */
export interface HeldReport {
  status: 'completed' | 'failed' | 'stopped'
  text: string | null
  /** The run stopped at its turn limit (CC `maxTurns`): the text is partial output. */
  partial?: boolean
}

const held = new Map<string, (report: HeldReport) => void>()

/**
 * Children whose latest run stopped at its turn limit. Recorded at the run's logical end
 * (`child-run-report.ts`) and taken by the launch that watches the child's first run, so the
 * delegating call can say "partial" rather than "failed" (CC: a subagent at `maxTurns` returns
 * its output marked as partial).
 */
const turnLimited = new Set<string>()

export function noteTurnLimit(childId: string, partial: boolean): void {
  if (partial) turnLimited.add(childId)
  else turnLimited.delete(childId)
}

/** True once when the child's latest run stopped at its turn limit. */
export function takeTurnLimit(childId: string): boolean {
  return turnLimited.delete(childId)
}

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
  turnLimited.clear()
  settledListeners.clear()
}
