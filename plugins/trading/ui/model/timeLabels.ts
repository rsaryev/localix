/**
 * How this workbench writes a moment — the chart's axis ticks and crosshair, and every account row
 * that carries a timestamp.
 *
 * lightweight-charts treats a `UTCTimestamp` as exactly that: it renders `14:00` for a bar that
 * opened at 14:00 **UTC**, whatever clock the trader is reading it beside. Nothing on the chart said
 * so. A trader lining a candle up against a funding settlement, a news print, or their own fill
 * timestamp was silently off by their UTC offset — nine hours in Tokyo, five in New York. Every
 * exchange front-end shows local time for this reason.
 *
 * So the chart formats its own labels, in the viewer's zone. The zone is a PARAMETER rather than an
 * ambient `toLocaleString` call, which is what lets these be tested against a fixed offset instead
 * of against whatever machine runs the suite.
 *
 * `undefined` means the viewer's own zone — the only correct default, and the one the chart passes.
 */

/** lightweight-charts' `TickMarkType`, by value. Re-declared rather than imported: the library's is
 *  a `const enum`, which cannot be used as a value at runtime under `isolatedModules`. */
export const TICK_YEAR = 0
export const TICK_MONTH = 1
export const TICK_DAY = 2
export const TICK_TIME = 3
export const TICK_TIME_WITH_SECONDS = 4

function parts(
  timeSec: number,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(new Date(timeSec * 1000))
}

/**
 * One axis tick, formatted for the granularity lightweight-charts asked for.
 *
 * The library decides WHICH ticks to draw and tells us what each one is the start of; we only decide
 * how it reads. A year tick shows the year, a month tick the month, a day tick the day — and the
 * zone matters even there: `00:30 UTC` on the 1st is still the previous month in Los Angeles.
 */
export function axisTickLabel(timeSec: number, tickMarkType: number, timeZone?: string): string {
  switch (tickMarkType) {
    case TICK_YEAR:
      return parts(timeSec, timeZone, { year: 'numeric' })
    case TICK_MONTH:
      return parts(timeSec, timeZone, { month: 'short' })
    case TICK_DAY:
      return parts(timeSec, timeZone, { day: 'numeric', month: 'short' })
    case TICK_TIME_WITH_SECONDS:
      return parts(timeSec, timeZone, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    default:
      return parts(timeSec, timeZone, { hour: '2-digit', minute: '2-digit', hour12: false })
  }
}

/**
 * A full moment — the day and the clock. What a trader reads to compare one thing against another:
 * a bar against a fill, an order still pending against how long it has been pending.
 *
 * `timestampMs` because every account timestamp in this workbench is in milliseconds; the chart's
 * are in seconds and convert at the call site.
 */
export function momentLabel(timestampMs: number, timeZone?: string): string {
  const timeSec = timestampMs / 1000
  // Composed from two formats rather than one: asking `Intl` for a date AND a time in `en-GB` yields
  // "1 Jan at 00:30", and the connecting word is a locale's, not ours.
  const date = parts(timeSec, timeZone, { day: 'numeric', month: 'short' })
  const clock = parts(timeSec, timeZone, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date}, ${clock}`
}

/** The crosshair's readout for a bar, whose `time` is in SECONDS. */
export function crosshairTimeLabel(timeSec: number, timeZone?: string): string {
  return momentLabel(timeSec * 1000, timeZone)
}

/**
 * A trade-tape print's clock, `HH:MM:SS` in the viewer's zone — the granularity a tape is read at
 * (recency and print rate). `—` when the venue did not stamp the print: an unstamped trade is UNDATED,
 * never `00:00:00`, which would read as a print from midnight.
 */
export function tradeTimeLabel(timestampMs: number | undefined, timeZone?: string): string {
  if (timestampMs === undefined || !Number.isFinite(timestampMs) || timestampMs <= 0) return '—'
  return parts(timestampMs / 1000, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
