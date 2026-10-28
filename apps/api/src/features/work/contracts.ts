/**
 * WHAT WORK A SESSION HAS RUNNING IN THE BACKGROUND, AND HOW EACH PIECE ENDED.
 *
 * Every kind — a detached bash job, a monitor, a live stream, a call promoted for outrunning its
 * budget — used to land in a process-wide map that forgot everything on restart, and a monitor
 * was ALSO kept by its own service under the same id. A work record is the one answer: one row
 * per piece of work, one id namespace per session, one owner filter, and a status that says how
 * it ended — including `lost`, which only a durable row can say.
 *
 * The record is data. What can be DONE to running work (kill, send input) stays with the live
 * process as its registered actions; a record outlives them.
 */

/**
 * `subagent` is a detached delegated child: it holds no process and no PTY, but it runs in the
 * background of the session that launched it exactly as a job does, and it can be lost the same way.
 */
export type WorkKind = 'job' | 'monitor' | 'stream' | 'promoted' | 'subagent'

/**
 * How work ended, in the vocabulary every reader shares:
 *   succeeded / failed — it ran to an exit and reported it;
 *   cancelled          — someone stopped it;
 *   timed-out          — its own deadline stopped it;
 *   lost               — the process running it died, so nobody knows how it ended.
 */
export type WorkStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out' | 'lost'

export interface WorkRecord {
  id: string
  userId: string
  sessionId: string
  /** What the agent and the user call it: `bg-3`, `mon-1`. Never reused within a session. */
  displayId: string
  kind: WorkKind
  label: string
  status: WorkStatus
  exitCode: number | null
  toolCallId: string
  /** The assistant message whose tool item shows this work. */
  messageId: string | null
  terminalId: string | null
  /** The delegated child session a `subagent` record stands for; null for every other kind. */
  childSessionId: string | null
  /**
   * What a monitor has seen: how many events, and the latest. Fields of the work rather than of
   * the watch, so the one list of a session's work shows what each monitor is seeing — the
   * monitor used to keep them in a map and a strip of its own.
   */
  eventCount: number
  lastEvent: string | null
  lastEventAt: string | null
  startedAt: string
  endedAt: string | null
}

export interface WorkOwner {
  userId: string
  sessionId: string
}

/** The job lifecycle's words (`completed`, `killed`, `timeout`, …), translated once. */
export function workStatusOfJob(jobStatus: string): WorkStatus {
  switch (jobStatus) {
    case 'completed':
      return 'succeeded'
    case 'killed':
      return 'cancelled'
    case 'timeout':
      return 'timed-out'
    default:
      return 'failed'
  }
}

/**
 * A delegated child's runtime words (`completed`, `stopped`, …), translated once. A child whose
 * status could not be read ended without saying how, which the report already calls a failure.
 */
export function workStatusOfChild(runtimeStatus: string | null): WorkStatus {
  if (runtimeStatus === 'completed') return 'succeeded'
  if (runtimeStatus === 'stopped') return 'cancelled'
  return 'failed'
}

/** The id prefix of each kind: a monitor is `mon-N`, a sub-agent `sub-N`, everything else `bg-N`. */
export const displayPrefix = (kind: WorkKind): 'mon' | 'sub' | 'bg' =>
  kind === 'monitor' ? 'mon' : kind === 'subagent' ? 'sub' : 'bg'
