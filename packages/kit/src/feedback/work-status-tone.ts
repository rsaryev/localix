/**
 * One standardized status vocabulary for WORK in progress — the composer row strips (sub-sessions,
 * background jobs, mini app strips). Each domain maps its own status onto a small set of TONES; the
 * tone picks a `StatusDot` color from the shared palette, so a green "done" / amber "running" /
 * red "error" pip means the same thing in every strip — and, through the kit, in every mini app
 * surface that draws the same work.
 *
 * Named for what it describes, a unit of work, because the SDK's `StatusTone` (`status-tone.ts`)
 * is a different vocabulary — the severity of a message (info / warning / error). The two used to
 * share a name and a near-identical file name, so importing the wrong one type-checked right up
 * until a value from the other set arrived.
 */
export type WorkStatusTone = 'running' | 'queued' | 'review' | 'done' | 'error' | 'idle'

export const STATUS_TONE_DOT: Record<WorkStatusTone, string> = {
  running: 'bg-status-warning animate-pulse-soft', // live, working now
  queued: 'bg-status-info', // ready / waiting to start
  review: 'bg-status-info animate-pulse-soft', // under review
  done: 'bg-status-success', // completed
  error: 'bg-status-error', // failed / blocked
  idle: 'bg-muted-foreground/50', // backlog / stopped / cancelled
}
