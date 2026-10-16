import { clockTime } from '@/shared/lib/calendarDay'

/**
 * When a message was said, for a reader scrolling a transcript.
 *
 * A wall clock, not "3h ago": the transcript is a record, and a relative age is the wrong
 * answer to "was this before or after lunch" — it also has to be re-rendered forever to stay
 * true.
 *
 * Just the clock, with no date. The day is stated once above the first message of each day
 * (`DayDivider`), which is both less repetition and a better answer: a date on every card
 * still leaves the reader working out where one day ends.
 */
export function messageClock(raw: string | undefined): string {
  if (!raw) return ''
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return ''
  return clockTime(at)
}
