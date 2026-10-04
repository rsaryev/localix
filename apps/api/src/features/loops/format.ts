// Pure, dependency-free formatting for session loops — the ONE source of truth
// for the web composer's loop strip and any other surface, so the cron→cadence
// mapping never drifts between them. Takes a structural shape
// (not the full contract type) to stay a true leaf importable anywhere.

export interface LoopCadenceInput {
  kind: 'fixed' | 'dynamic'
  cron: string | null
  delaySeconds?: number
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "9:05" from hour 9, minute 5 — a friendly 24h clock label. */
function clock(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, '0')}`
}

/**
 * Human cadence label — a readable phrase for fixed loops, "dynamic" for self-pacing ones. Covers the common
 * shapes the agent emits (interval, daily/weekday/single-day clock times); any
 * cron it doesn't recognize is echoed verbatim so nothing is ever mislabeled.
 */
export function loopCadenceLabel(loop: LoopCadenceInput): string {
  if (loop.kind === 'dynamic') {
    return loop.delaySeconds ? `dynamic · ~${Math.round(loop.delaySeconds / 60)}m` : 'dynamic'
  }
  const cron = loop.cron ?? ''
  let m: RegExpMatchArray | null
  // Every-N intervals.
  if ((m = cron.match(/^\*\/(\d+) \* \* \* \*$/))) return `every ${m[1]}m`
  if ((m = cron.match(/^0 \*\/(\d+) \* \* \*$/))) return `every ${m[1]}h`
  if ((m = cron.match(/^0 0 \*\/(\d+) \* \*$/))) return `every ${m[1]}d`
  if (cron === '0 0 * * *') return 'daily'
  if (cron === '0 * * * *') return 'hourly'
  // Hourly at a specific minute, e.g. "7 * * * *" → "hourly at :07".
  if ((m = cron.match(/^(\d{1,2}) \* \* \* \*$/))) return `hourly at :${m[1].padStart(2, '0')}`
  // A fixed clock time on some/all days: "min hour * * <dow>".
  if ((m = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|0,6|6,0|[0-7])$/))) {
    const time = clock(Number(m[2]), Number(m[1]))
    const dow = m[3]
    if (dow === '*') return `daily at ${time}`
    if (dow === '1-5') return `weekdays at ${time}`
    if (dow === '0,6' || dow === '6,0') return `weekends at ${time}`
    return `${WEEKDAY_NAMES[Number(dow) % 7]}s at ${time}`
  }
  return cron
}

/**
 * Human preview of a loop's task line, owned here so every surface shows the same
 * one. The maintenance routine has no explicit task, so it shows a
 * stable label instead of leaking its long multi-line boilerplate prompt.
 */
export function loopPreview(loop: { maintenance: boolean; prompt: string }): string {
  return loop.maintenance ? 'Maintenance routine' : loop.prompt
}

/**
 * A fire time in the zone the schedule is EVALUATED in, with that zone named.
 *
 * Cron expressions run in the server's local time (`schedule.ts` hands croner no zone), and the
 * agent reads these times back to decide what to write next. The tool used to print the UTC
 * instant labelled "UTC" beside a schema that says "LOCAL server time": an agent in UTC+3 asked
 * for 09:00, read "06:00 UTC", and had two readings to pick from. Printing the local wall clock
 * with its IANA zone and offset leaves one.
 */
export function loopClockTime(iso: string, timeZone?: string): string {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  // `longOffset` renders a zero offset as a bare "GMT"; spell it so every line has the same shape.
  const offset = part('timeZoneName').replace(/^GMT/, '') || '+00:00'
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${zone} (UTC${offset})`
}

/** Compact relative time to a future ISO timestamp ("4m", "30s", "now"); "idle" when null. */
export function loopCountdown(isoTarget: string | null, nowMs: number): string {
  if (!isoTarget) return 'idle'
  const diffMs = new Date(isoTarget).getTime() - nowMs
  if (diffMs <= 0) return 'now'
  const s = Math.round(diffMs / 1000)
  if (s < 60) return `${s}s`
  const mins = Math.round(s / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.round(mins / 60)}h`
}

/**
 * Why a loop is not firing right now, when the reason is not "it is simply not due yet".
 *
 * The hold this reports was invisible: `lastStatus` describes whether the WAKE was delivered
 * ("ok" = enqueued), not whether the run succeeded, so once a session's provider allowance ran
 * out the loop kept reading `ok` while quietly doing nothing for up to an hour — with the
 * next-run countdown still ticking down and restarting as if occurrences were being spent.
 *
 * Returns null when nothing is holding the loop, so a caller can render the ordinary countdown.
 */
export function loopHoldLabel(loop: { heldUntil?: string | null }, nowMs: number): string | null {
  if (!loop.heldUntil) return null
  const diffMs = new Date(loop.heldUntil).getTime() - nowMs
  // An expired hold is not a hold. The value is derived at read time, but a client can hold a
  // snapshot across the moment it lapses.
  if (!Number.isFinite(diffMs) || diffMs <= 0) return null
  return `held ${loopCountdown(loop.heldUntil, nowMs)} · provider limit`
}

/**
 * What the last fire's recorded status actually MEANS — which differs by target, and used to be
 * printed as a bare "ok" that read as "the run went fine" either way.
 *
 * - `target: 'session'` — the fire enqueues a wake into the owning session and the engine records
 *   the outcome of THAT (`wakeSession(...).then(() => ok)`). The run's own success or failure never
 *   reaches the loop record, so "ok" means DELIVERED, nothing more. This is what made an exhausted
 *   quota invisible: occurrences were being dropped while the loop still read `ok`.
 * - `target: 'subsession'` — the fire awaits the child run and reports its terminal status
 *   (`completed` → ok, anything else → error naming the status), so "ok" really is "the run
 *   finished".
 *
 * Vocabulary unchanged on the wire and in the DB ('ok' | 'error'); only the WORD shown differs, so
 * no consumer has to learn a new value.
 */
export function loopLastStatusLabel(loop: {
  target?: 'session' | 'subsession'
  lastStatus: 'ok' | 'error' | null
}): string {
  if (loop.lastStatus === 'error') return 'error'
  if (loop.lastStatus !== 'ok') return 'pending'
  return loop.target === 'subsession' ? 'completed' : 'delivered'
}
